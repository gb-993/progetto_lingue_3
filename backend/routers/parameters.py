from typing import Optional, List
from datetime import datetime
import io
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func, case
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload
import auth
import models
from dependencies import get_db, require_admin
from services.logic_parser import validate_expression, ParseException
from services.recompute import recompute_parameter_for_all_languages
from services.versioning import record_version
from services.pdf_export import build_parameter_pdf, build_all_parameters_pdf, build_parameter_changelog_pdf


router = APIRouter(prefix="/api/admin/parameters", tags=["Parameters"])

# --- SCHEMI PYDANTIC ---

class QuestionRead(BaseModel):
    id: str
    text: str
    is_stop_question: bool
    is_active: bool = True

    class Config:
        from_attributes = True

class ParameterChangeLogRead(BaseModel):
    id: int
    change_note: str
    created_at: datetime

    class Config:
        from_attributes = True

class ParameterBase(BaseModel):
    id: str
    name: str
    position: int
    short_description: str = ""
    long_description: str = ""
    implicational_condition: Optional[str] = None
    description_of_the_implicational_condition: str = ""
    is_active: bool = True
    schema: str = ""
    param_type: str = ""
    level_of_comparison: str = ""

class ParameterListItem(ParameterBase):
    questions_count: int = 0
    stop_count: int = 0

# Schema per l'aggiornamento che accetta la motivazione opzionale
class ParameterUpdate(ParameterBase):
    change_note: Optional[str] = ""

# Nuovo schema per il dettaglio che include le domande e i log
class ParameterDetail(ParameterBase):
    questions: List[QuestionRead] = []
    change_logs: List[ParameterChangeLogRead] = []

    class Config:
        from_attributes = True

# Schema per la disattivazione sicura
class DeactivatePayload(BaseModel):
    password: str
    reason: Optional[str] = ""

# --- ENDPOINT ---

@router.get("", response_model=List[ParameterListItem])
def get_admin_parameters(db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    Q = models.Question
    questions_count = func.coalesce(
        func.sum(case((Q.is_stop_question == False, 1), else_=0)), 0
    ).label("questions_count")
    stop_count = func.coalesce(
        func.sum(case((Q.is_stop_question == True, 1), else_=0)), 0
    ).label("stop_count")

    rows = (
        db.query(models.ParameterDef, questions_count, stop_count)
        .outerjoin(Q, Q.parameter_id == models.ParameterDef.id)
        .group_by(models.ParameterDef.id)
        .order_by(models.ParameterDef.position, models.ParameterDef.id)
        .all()
    )

    out: List[ParameterListItem] = []
    for p, qc, sc in rows:
        out.append(ParameterListItem(
            id=p.id,
            name=p.name,
            position=p.position,
            short_description=p.short_description or "",
            long_description=p.long_description or "",
            implicational_condition=p.implicational_condition,
            description_of_the_implicational_condition=p.description_of_the_implicational_condition or "",
            is_active=p.is_active,
            schema=p.schema or "",
            param_type=p.param_type or "",
            level_of_comparison=p.level_of_comparison or "",
            questions_count=int(qc or 0),
            stop_count=int(sc or 0),
        ))
    return out

@router.get("/{id}", response_model=ParameterDetail)
def get_admin_parameter(id: str, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    # Usiamo joinedload per le domande e selectinload per i log
    parameter = db.query(models.ParameterDef).options(
        joinedload(models.ParameterDef.questions),
        selectinload(models.ParameterDef.change_logs)
    ).filter(models.ParameterDef.id == id).first()
    if not parameter:
        raise HTTPException(status_code=404, detail="Parameter not found")
    return parameter

@router.post("", status_code=status.HTTP_201_CREATED)
def create_admin_parameter(item: ParameterBase, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    db_item = models.ParameterDef(**item.dict())
    db.add(db_item)
    # Blocca il salvataggio se il TUDO parser fallisce
    if item.implicational_condition:
        try:
            validate_expression(item.implicational_condition)
        except ParseException as e:
            raise HTTPException(status_code=400, detail=f"Wrong formula syntax: {str(e)}")
    try:
        db.commit()
        db.refresh(db_item)
        record_version(db, db_item, operation="create", source="manual", user_id=current_user.id)
        db.commit()
        return db_item
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Duplicate ID or invalid data.")

# Schema per il riordino drag&drop
class ReorderPayload(BaseModel):
    moved_id: str
    order: List[str]


@router.patch("/reorder")
def reorder_parameters(
    payload: ReorderPayload,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    if not payload.order:
        raise HTTPException(status_code=400, detail="Empty order.")
    if len(payload.order) != len(set(payload.order)):
        raise HTTPException(status_code=400, detail="Duplicate IDs in order.")

    db_params = db.query(models.ParameterDef).all()
    db_ids = {p.id for p in db_params}
    payload_ids = set(payload.order)

    if db_ids != payload_ids:
        raise HTTPException(
            status_code=409,
            detail="Parameter list out of sync with the server. Please refresh the page.",
        )
    if payload.moved_id not in db_ids:
        raise HTTPException(status_code=404, detail="Moved parameter not found.")

    by_id = {p.id: p for p in db_params}
    moved = by_id[payload.moved_id]
    old_position = moved.position
    new_position = payload.order.index(payload.moved_id) + 1

    changed = False
    for idx, pid in enumerate(payload.order):
        target_pos = idx + 1
        if by_id[pid].position != target_pos:
            by_id[pid].position = target_pos
            changed = True

    if not changed:
        return {
            "detail": "No change.",
            "moved_id": payload.moved_id,
            "old_position": old_position,
            "new_position": new_position,
        }

    log = models.ParameterChangeLog(
        parameter_id=payload.moved_id,
        user_id=current_user.id,
        change_note=f"Position: {old_position} → {new_position}",
    )
    db.add(log)

    try:
        db.commit()
        record_version(
            db, moved, operation="update", source="manual",
            user_id=current_user.id,
            note=f"Reorder: position {old_position} → {new_position}",
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Reorder error.")

    return {
        "detail": "Reordered.",
        "moved_id": payload.moved_id,
        "old_position": old_position,
        "new_position": new_position,
    }


@router.put("/{id}")
def update_admin_parameter(id: str, item: ParameterUpdate, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    db_item = db.query(models.ParameterDef).filter(models.ParameterDef.id == id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Parameter not found")

    # Escludiamo is_active e change_note dal normale PUT
    update_data = item.dict(exclude={'is_active', 'change_note'})
    for key, value in update_data.items():
        setattr(db_item, key, value)

    # Blocca il salvataggio se il TUDO parser fallisce
    if item.implicational_condition:
        try:
            validate_expression(item.implicational_condition)
        except ParseException as e:
            raise HTTPException(status_code=400, detail=f"Wrong formula syntax: {str(e)}")

    # Registra il log di modifica se presente
    if item.change_note and item.change_note.strip():
        log = models.ParameterChangeLog(
            parameter_id=id,
            user_id=current_user.id,
            change_note=item.change_note.strip()
        )
        db.add(log)

    try:
        db.commit()
        record_version(db, db_item, operation="update", source="manual",
                       user_id=current_user.id, note=(item.change_note or None))
        db.commit()
        return db_item
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Update error.")


@router.post("/{id}/deactivate")
def deactivate_parameter(id: str, payload: DeactivatePayload, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    # 1. Verifica Password
    if not auth.verify_password(payload.password, current_user.hashed_password):
        raise HTTPException(status_code=403, detail="Wrong password. Cannot deactivate.")

    db_item = db.query(models.ParameterDef).filter(models.ParameterDef.id == id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Parameter not found")

    # 2. Verifica Dipendenze
    used_in = db.query(models.ParameterDef).filter(
        models.ParameterDef.is_active == True,
        models.ParameterDef.implicational_condition.ilike(f"%{id}%")
    ).all()

    if used_in:
        raise HTTPException(status_code=400, detail="Cannot deactivate: the parameter is used in the implicational conditions of other active parameters.")

    # 3. Disattiva e logga
    db_item.is_active = False

    if payload.reason:
        log = models.ParameterChangeLog(
            parameter_id=id,
            user_id=current_user.id,
            change_note=f"DEACTIVATED. Reason: {payload.reason}"
        )
        db.add(log)

    db.commit()
    record_version(db, db_item, operation="update", source="manual",
                   user_id=current_user.id,
                   note=f"Deactivated{f': {payload.reason}' if payload.reason else ''}")
    db.commit()
    return {"detail": "Parameter successfully deactivated."}

class ParametersInfoPdfPayload(BaseModel):
    # Lista opzionale di ID; se vuota/omessa, esporta tutti i parametri.
    param_ids: Optional[List[str]] = None


@router.post("/export/info-pdf")
def export_parameters_info_pdf(
    payload: ParametersInfoPdfPayload,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    """PDF con le info generali (no domande) di tutti i parametri richiesti.

    Pensato come overview compatta da stampare/condividere coi linguisti:
    una pagina di indice + una sezione per parametro con info di base,
    descrizioni e logica.
    """
    q = db.query(models.ParameterDef)
    if payload.param_ids:
        q = q.filter(models.ParameterDef.id.in_(payload.param_ids))
    parameters = q.order_by(models.ParameterDef.position, models.ParameterDef.id).all()

    pdf_bytes = build_all_parameters_pdf(parameters)
    buf = io.BytesIO(pdf_bytes)
    buf.seek(0)
    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    filename = f"PCM_parameters_info_{ts}.pdf"
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{id}/pdf")
def download_parameter_pdf(id: str, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    parameter = db.query(models.ParameterDef).filter(models.ParameterDef.id == id).first()
    if not parameter:
        raise HTTPException(status_code=404, detail="Parameter not found")

    questions = (
        db.query(models.Question)
        .options(selectinload(models.Question.allowed_motivations).joinedload(models.QuestionAllowedMotivation.motivation))
        .filter(models.Question.parameter_id == id)
        .order_by(models.Question.is_stop_question, models.Question.id)
        .all()
    )

    pdf_bytes = build_parameter_pdf(parameter, questions)
    buf = io.BytesIO(pdf_bytes)
    buf.seek(0)
    filename = f"Parameter_{parameter.id}.pdf"
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{id}/changelog-pdf")
def download_parameter_changelog_pdf(id: str, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    parameter = db.query(models.ParameterDef).filter(models.ParameterDef.id == id).first()
    if not parameter:
        raise HTTPException(status_code=404, detail="Parameter not found")

    logs = (
        db.query(models.ParameterChangeLog)
        .options(joinedload(models.ParameterChangeLog.user))
        .filter(models.ParameterChangeLog.parameter_id == id)
        .order_by(models.ParameterChangeLog.created_at.desc())
        .all()
    )

    pdf_bytes = build_parameter_changelog_pdf(parameter, logs)
    buf = io.BytesIO(pdf_bytes)
    buf.seek(0)
    filename = f"Parameter_{parameter.id}_changelog.pdf"
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/{id}/reactivate")
def reactivate_parameter(id: str, background_tasks: BackgroundTasks, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    db_item = db.query(models.ParameterDef).filter(models.ParameterDef.id == id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Parameter not found")

    db_item.is_active = True
    db.commit()
    record_version(db, db_item, operation="update", source="manual",
                   user_id=current_user.id, note="Reactivated")
    db.commit()

    # Durante la disattivazione il parametro era escluso dal DAG, quindi i suoi
    # value_orig/value_eval e quelli dei figli che lo citano sono potenzialmente
    # stale. Ricalcoliamo in background per tutte le lingue: il param_consolidate
    # e poi il DAG (che internamente parte dall'intero grafo dei parametri attivi
    # per la lingua) riallineano tutto.
    background_tasks.add_task(recompute_parameter_for_all_languages, id)

    return {"detail": "Parameter successfully reactivated."}


# --- ENDPOINT PER LA VALIDAZIONE SINTASSI IN TEMPO REALE ---
class ConditionCheck(BaseModel):
    condition: str

@router.post("/validate-condition")
def validate_condition_api(payload: ConditionCheck, db: Session = Depends(get_db)):
    if not payload.condition:
        return {"valid": True, "error": None}
    try:
        # Usa ESATTAMENTE la tua funzione!
        validate_expression(payload.condition)
        return {"valid": True, "error": None}
    except ParseException as e:
        return {"valid": False, "error": str(e)}

# --- ENDPOINT "WHERE USED" (Mantenuto perché fa solo una query al DB utilissima) ---
@router.get("/{id}/usage")
def get_parameter_usage(id: str, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    used_in = db.query(models.ParameterDef).filter(
        models.ParameterDef.implicational_condition.ilike(f"%{id}%")
    ).all()
    return [{"id": p.id, "name": p.name} for p in used_in if p.id != id]

# ==========================================
# ENDPOINT LOOKUPS
# ==========================================

class LookupBase(BaseModel):
    label: str

@router.get("/lookups/schemas")
def get_schemas(db: Session = Depends(get_db)):
    return [{"id": item.id, "label": item.label} for item in db.query(models.ParamSchema).all()]

@router.post("/lookups/schemas")
def create_schema(item: LookupBase, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    db_item = models.ParamSchema(label=item.label)
    db.add(db_item)
    try:
        db.commit()
        return {"id": db_item.id, "label": db_item.label}
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Schema already exists")

@router.delete("/lookups/schemas/{lookup_id}")
def delete_schema(lookup_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    item = db.query(models.ParamSchema).filter(models.ParamSchema.id == lookup_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Schema not found")
    in_use = db.query(models.ParameterDef).filter(models.ParameterDef.schema == item.label).count()
    if in_use > 0:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete: schema '{item.label}' is used by {in_use} parameter(s).",
        )
    db.delete(item)
    db.commit()
    return {"detail": "Schema deleted"}

@router.get("/lookups/types")
def get_types(db: Session = Depends(get_db)):
    return [{"id": item.id, "label": item.label} for item in db.query(models.ParamType).all()]

@router.post("/lookups/types")
def create_type(item: LookupBase, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    db_item = models.ParamType(label=item.label)
    db.add(db_item)
    try:
        db.commit()
        return {"id": db_item.id, "label": db_item.label}
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Type already exists")

@router.delete("/lookups/types/{lookup_id}")
def delete_type(lookup_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    item = db.query(models.ParamType).filter(models.ParamType.id == lookup_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Type not found")
    in_use = db.query(models.ParameterDef).filter(models.ParameterDef.param_type == item.label).count()
    if in_use > 0:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete: type '{item.label}' is used by {in_use} parameter(s).",
        )
    db.delete(item)
    db.commit()
    return {"detail": "Type deleted"}

@router.get("/lookups/levels")
def get_levels(db: Session = Depends(get_db)):
    return [{"id": item.id, "label": item.label} for item in db.query(models.ParamLevelOfComparison).all()]

@router.post("/lookups/levels")
def create_level(item: LookupBase, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    db_item = models.ParamLevelOfComparison(label=item.label)
    db.add(db_item)
    try:
        db.commit()
        return {"id": db_item.id, "label": db_item.label}
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Level already exists")

@router.delete("/lookups/levels/{lookup_id}")
def delete_level(lookup_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    item = db.query(models.ParamLevelOfComparison).filter(models.ParamLevelOfComparison.id == lookup_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Level not found")
    in_use = db.query(models.ParameterDef).filter(models.ParameterDef.level_of_comparison == item.label).count()
    if in_use > 0:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete: level '{item.label}' is used by {in_use} parameter(s).",
        )
    db.delete(item)
    db.commit()
    return {"detail": "Level deleted"}