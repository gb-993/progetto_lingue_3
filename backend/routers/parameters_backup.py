import io
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

import models
from dependencies import get_db, require_admin
from services import parameter_backup_service
from services.backup_service import workbook_to_bytes

router = APIRouter(prefix="/api/admin/backups/parameters", tags=["ParameterBackups"])

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


class BackupCreatePayload(BaseModel):
    note: Optional[str] = ""


@router.get("")
def get_parameter_backup_folders(
    db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)
):
    """Cartelle: raggruppa le ParameterSubmission per `submitted_at`."""
    results = (
        db.query(
            models.ParameterSubmission.submitted_at,
            models.ParameterSubmission.note,
            models.User.email.label("user_email"),
            func.count(models.ParameterSubmission.id).label("param_count"),
        )
        .outerjoin(
            models.User, models.ParameterSubmission.submitted_by_id == models.User.id
        )
        .group_by(
            models.ParameterSubmission.submitted_at,
            models.ParameterSubmission.note,
            models.User.email,
        )
        .order_by(models.ParameterSubmission.submitted_at.desc())
        .all()
    )

    return [
        {
            "timestamp": r.submitted_at.isoformat(),
            "note": r.note,
            "user_email": r.user_email,
            "param_count": r.param_count,
        }
        for r in results
    ]


@router.get("/folder")
def get_parameter_backup_folder_details(
    timestamp: datetime,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    """Lista parametri salvati in un preciso timestamp."""
    submissions = (
        db.query(models.ParameterSubmission)
        .filter(models.ParameterSubmission.submitted_at == timestamp)
        .order_by(models.ParameterSubmission.position, models.ParameterSubmission.parameter_id)
        .all()
    )

    return [
        {
            "id": sub.id,
            "parameter_id": sub.parameter_id,
            "parameter_name": sub.parameter_name,
            "schema": sub.schema,
            "param_type": sub.param_type,
            "is_active": sub.is_active,
        }
        for sub in submissions
    ]


@router.get("/submissions/{submission_id}")
def get_parameter_submission_detail(
    submission_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    """Dettaglio: definizione del parametro + questions + motivations ammesse."""
    sub = (
        db.query(models.ParameterSubmission)
        .options(
            joinedload(models.ParameterSubmission.submitted_by),
            joinedload(models.ParameterSubmission.questions)
            .joinedload(models.ParameterSubmissionQuestion.allowed_motivations),
        )
        .filter(models.ParameterSubmission.id == submission_id)
        .first()
    )

    if not sub:
        raise HTTPException(status_code=404, detail="Parameter submission not found")

    return {
        "id": sub.id,
        "parameter": {
            "id": sub.parameter_id,
            "name": sub.parameter_name,
            "short_description": sub.short_description,
            "long_description": sub.long_description,
            "implicational_condition": sub.implicational_condition,
            "description_of_the_implicational_condition":
                sub.description_of_the_implicational_condition,
            "is_active": sub.is_active,
            "position": sub.position,
            "schema": sub.schema,
            "param_type": sub.param_type,
            "level_of_comparison": sub.level_of_comparison,
        },
        "submitted_at": sub.submitted_at.isoformat() if sub.submitted_at else None,
        "submitted_by": (
            f"{sub.submitted_by.name} {sub.submitted_by.surname}"
            if sub.submitted_by else "System"
        ),
        "note": sub.note,
        "questions": [
            {
                "question_code": q.question_code,
                "text": q.text,
                "template_type": q.template_type,
                "instruction": q.instruction,
                "instruction_yes": q.instruction_yes,
                "instruction_no": q.instruction_no,
                "example_yes": q.example_yes,
                "help_info": q.help_info,
                "is_stop_question": q.is_stop_question,
                "is_active": q.is_active,
                "allowed_motivations": [
                    {"code": m.motivation_code, "label": m.motivation_label}
                    for m in q.allowed_motivations
                ],
            }
            for q in sub.questions
        ],
    }


@router.get("/submissions/{submission_id}/xlsx")
def export_parameter_submission_xlsx(
    submission_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    """Scarica il backup di un parametro come xlsx (3 sheet: Info, Questions,
    AllowedMotivations). Equivalente al download .xlsx degli altri backup."""
    sub = (
        db.query(models.ParameterSubmission)
        .options(
            joinedload(models.ParameterSubmission.submitted_by),
            joinedload(models.ParameterSubmission.questions)
            .joinedload(models.ParameterSubmissionQuestion.allowed_motivations),
        )
        .filter(models.ParameterSubmission.id == submission_id)
        .first()
    )
    if not sub:
        raise HTTPException(status_code=404, detail="Parameter submission not found")

    wb = parameter_backup_service.build_parameter_submission_workbook(db, sub)
    data = workbook_to_bytes(wb)

    ts = (sub.submitted_at or datetime.utcnow()).strftime("%Y%m%d_%H%M")
    pid = sub.parameter_id or "unknown"
    fname = f"PCM_param_backup_{pid}_{ts}.xlsx"
    return StreamingResponse(
        io.BytesIO(data),
        media_type=XLSX_MIME,
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.post("/create-all", status_code=status.HTTP_201_CREATED)
def trigger_global_parameters_backup(
    payload: BackupCreatePayload,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    """Backup globale: uno snapshot per ogni parametro, stesso timestamp."""
    try:
        return parameter_backup_service.create_all_parameters_backup(
            db, current_user.id, payload.note
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/create-one/{parameter_id}", status_code=status.HTTP_201_CREATED)
def trigger_single_parameter_backup(
    parameter_id: str,
    payload: BackupCreatePayload,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    """Backup di un singolo parametro (cartella dedicata)."""
    parameter = db.query(models.ParameterDef).filter(
        models.ParameterDef.id == parameter_id
    ).first()
    if not parameter:
        raise HTTPException(status_code=404, detail="Parameter not found")
    try:
        return parameter_backup_service.create_single_parameter_backup(
            db, parameter, current_user.id, payload.note
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{timestamp}")
def delete_parameter_backup_folder(
    timestamp: datetime,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    """Elimina tutte le ParameterSubmission con quel timestamp."""
    deleted = (
        db.query(models.ParameterSubmission)
        .filter(models.ParameterSubmission.submitted_at == timestamp)
        .delete()
    )
    db.commit()

    if deleted == 0:
        raise HTTPException(status_code=404, detail="No parameters backup found for this date.")
    return {"detail": f"Parameters backup deleted. ({deleted} records removed)"}
