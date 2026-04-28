from typing import Optional, List
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload
import auth
import models
from dependencies import get_db, require_admin
from services.logic_parser import validate_expression, ParseException
from services.versioning import record_version


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

@router.get("", response_model=List[ParameterBase])
def get_admin_parameters(db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    return db.query(models.ParameterDef).order_by(models.ParameterDef.position, models.ParameterDef.id).all()

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

@router.post("/{id}/reactivate")
def reactivate_parameter(id: str, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    db_item = db.query(models.ParameterDef).filter(models.ParameterDef.id == id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Parameter not found")

    db_item.is_active = True
    db.commit()
    record_version(db, db_item, operation="update", source="manual",
                   user_id=current_user.id, note="Reactivated")
    db.commit()
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
def create_schema(item: LookupBase, db: Session = Depends(get_db)):
    db_item = models.ParamSchema(label=item.label)
    db.add(db_item)
    try:
        db.commit()
        return {"id": db_item.id, "label": db_item.label}
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Schema already exists")

@router.get("/lookups/types")
def get_types(db: Session = Depends(get_db)):
    return [{"id": item.id, "label": item.label} for item in db.query(models.ParamType).all()]

@router.post("/lookups/types")
def create_type(item: LookupBase, db: Session = Depends(get_db)):
    db_item = models.ParamType(label=item.label)
    db.add(db_item)
    try:
        db.commit()
        return {"id": db_item.id, "label": db_item.label}
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Type already exists")

@router.get("/lookups/levels")
def get_levels(db: Session = Depends(get_db)):
    return [{"id": item.id, "label": item.label} for item in db.query(models.ParamLevelOfComparison).all()]

@router.post("/lookups/levels")
def create_level(item: LookupBase, db: Session = Depends(get_db)):
    db_item = models.ParamLevelOfComparison(label=item.label)
    db.add(db_item)
    try:
        db.commit()
        return {"id": db_item.id, "label": db_item.label}
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Level already exists")