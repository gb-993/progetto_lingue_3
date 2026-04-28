from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

import models
from dependencies import get_db, require_admin, get_current_user
from services import backup_service

router = APIRouter(prefix="/api/admin/backups", tags=["Backups"])

# Schema per il payload della creazione
class BackupCreatePayload(BaseModel):
    note: Optional[str] = ""

@router.get("")
def get_backup_folders(db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    """
    Raggruppa le submission per 'submitted_at' simulando una "Cartella di backup".
    """
    results = db.query(
        models.Submission.submitted_at,
        models.Submission.note,
        models.User.email.label('user_email'),
        func.count(models.Submission.id).label('lang_count')
    ).outerjoin(
        models.User, models.Submission.submitted_by_id == models.User.id
    ).group_by(
        models.Submission.submitted_at, models.Submission.note, models.User.email
    ).order_by(
        models.Submission.submitted_at.desc()
    ).all()

    return [
        {
            "timestamp": r.submitted_at.isoformat(),
            "note": r.note,
            "user_email": r.user_email,
            "lang_count": r.lang_count
        }
        for r in results
    ]

@router.get("/folder")
def get_backup_folder_details(timestamp: datetime, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    """
    Recupera l'elenco delle lingue salvate in un preciso timestamp (dentro una cartella).
    """
    submissions = db.query(models.Submission).options(
        joinedload(models.Submission.language)
    ).filter(models.Submission.submitted_at == timestamp).all()

    return [
        {
            "id": sub.id,
            "language_id": sub.language_id,
            "language_name": sub.language.name_full if sub.language else "Unknown",
            "status": "Saved"
        }
        for sub in submissions
    ]

@router.get("/submissions/{submission_id}")
def get_submission_detail(submission_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    """
    Recupera i dati granulari di un singolo salvataggio storico (Parametri, Risposte, Esempi).
    """
    sub = db.query(models.Submission).options(
        joinedload(models.Submission.language),
        joinedload(models.Submission.submitted_by),
        joinedload(models.Submission.params),
        joinedload(models.Submission.answers),
        joinedload(models.Submission.examples),
        joinedload(models.Submission.answer_motivations)
    ).filter(models.Submission.id == submission_id).first()

    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")

    # Raggruppiamo le motivazioni per question_code come faceva Django
    mots_by_q = {}
    for m in sub.answer_motivations:
        mots_by_q.setdefault(m.question_code, []).append(m.motivation_code)

    answers_formatted = []
    for a in sub.answers:
        answers_formatted.append({
            "question_code": a.question_code,
            "response_text": a.response_text,
            "comments": a.comments,
            "motivations": mots_by_q.get(a.question_code, [])
        })

    return {
        "id": sub.id,
        "language": {"id": sub.language_id, "name": sub.language.name_full} if sub.language else None,
        "submitted_at": sub.submitted_at.isoformat(),
        "submitted_by": f"{sub.submitted_by.name} {sub.submitted_by.surname}" if sub.submitted_by else "System",
        "note": sub.note,
        "params": [
            {
                "parameter_id": p.parameter_id,
                "value_orig": p.value_orig,
                "warning_orig": p.warning_orig,
                "value_eval": p.value_eval,
                "warning_eval": p.warning_eval
            } for p in sub.params
        ],
        "answers": answers_formatted,
        "examples": [
            {
                "question_code": e.question_code,
                "textarea": e.textarea,
                "translation": e.translation,
                "gloss": e.gloss,
                "transliteration": e.transliteration,
                "reference": e.reference
            } for e in sub.examples
        ]
    }

@router.post("/create-all", status_code=status.HTTP_201_CREATED)
def trigger_global_backup(payload: BackupCreatePayload, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    """
    Genera un backup globale per tutte le lingue.
    """
    try:
        result = backup_service.create_all_languages_backup(db, current_user.id, payload.note)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/{timestamp}")
def delete_backup_folder(timestamp: datetime, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    """
    Elimina tutti i salvataggi associati a un preciso timestamp (elimina la cartella).
    """
    deleted = db.query(models.Submission).filter(models.Submission.submitted_at == timestamp).delete()
    db.commit()

    if deleted == 0:
        raise HTTPException(status_code=404, detail="No backup found for this date.")
    return {"detail": f"Backup deleted. ({deleted} records removed)"}