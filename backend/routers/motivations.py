from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import models
from dependencies import get_db, require_admin
from services.versioning import record_version

router = APIRouter(prefix="/api/admin/motivations", tags=["Motivations"])

# --- SCHEMA PYDANTIC ---
class MotivationBase(BaseModel):
    code: str
    label: str

class MotivationRead(MotivationBase):
    id: int

    class Config:
        from_attributes = True

# --- ENDPOINT ---
@router.get("", response_model=List[MotivationRead])
def get_motivations(db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    """Recupera la lista delle motivazioni."""
    return db.query(models.Motivation).order_by(models.Motivation.code).all()


@router.get("/with-usage")
def get_motivations_with_usage(db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    """Lista motivazioni + per ognuna le question_id in cui è abilitata.

    Una sola query per QuestionAllowedMotivation, raggruppata in memoria così
    evitiamo N+1. Usato dalla pagina admin per mostrare i link "where used".
    """
    mots = db.query(models.Motivation).order_by(models.Motivation.code).all()
    links = (
        db.query(models.QuestionAllowedMotivation.motivation_id, models.QuestionAllowedMotivation.question_id)
        .all()
    )
    by_mid: dict[int, list[str]] = {}
    for mid, qid in links:
        by_mid.setdefault(mid, []).append(qid)
    for qids in by_mid.values():
        qids.sort()
    return [
        {
            "id": m.id,
            "code": m.code,
            "label": m.label,
            "linked_questions": by_mid.get(m.id, []),
        }
        for m in mots
    ]

@router.post("", response_model=MotivationRead, status_code=status.HTTP_201_CREATED)
def create_motivation(item: MotivationBase, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    """Crea una nuova motivazione (usata sia in pagina che 'on the fly' nel creatable select)"""
    db_item = models.Motivation(
        code=item.code,
        label=item.label,
    )
    db.add(db_item)
    try:
        db.commit()
        db.refresh(db_item)
        record_version(db, db_item, operation="create", source="manual", user_id=current_user.id)
        db.commit()
        return db_item
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Could not create the motivation. Please check the input data.")

@router.put("/{id}", response_model=MotivationRead)
def update_motivation(id: int, item: MotivationBase, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    """Aggiorna testo di una motivazione e propaga il log ai parametri e domande interessate"""
    db_item = db.query(models.Motivation).filter(models.Motivation.id == id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Motivation not found")

    # Rileva le modifiche per creare un log automatico
    changes = []
    if db_item.code != item.code:
        changes.append(f"code changed from '{db_item.code}' to '{item.code}'")
    if db_item.label != item.label:
        changes.append("description updated")

    db_item.code = item.code
    db_item.label = item.label

    # Se ci sono state modifiche effettive, loggale sui parametri associati specificando la domanda
    if changes:
        # Trova le coppie (parameter_id, question_id) univoche collegate a questa motivazione
        affected_questions = db.query(
            models.Question.parameter_id,
            models.Question.id
        ).join(
            models.QuestionAllowedMotivation,
            models.Question.id == models.QuestionAllowedMotivation.question_id
        ).filter(
            models.QuestionAllowedMotivation.motivation_id == id
        ).distinct().all()

        for param_id, question_id in affected_questions:
            log_msg = f"[Question {question_id} - Motivation {item.code}] Global change: {', '.join(changes)}"

            log = models.ParameterChangeLog(
                parameter_id=param_id,
                user_id=current_user.id,
                change_note=log_msg
            )
            db.add(log)

    try:
        db.commit()
        db.refresh(db_item)
        record_version(db, db_item, operation="update", source="manual", user_id=current_user.id)
        db.commit()
        return db_item
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Could not update the motivation.")

@router.delete("/{id}")
def delete_motivation(id: int, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    db_item = db.query(models.Motivation).filter(models.Motivation.id == id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Motivation not found")

    # Snapshot finale registrato PRIMA del delete: dopo db.delete + commit
    # l'entità non è più caricabile e perderemmo lo storico.
    record_version(db, db_item, operation="delete", source="manual", user_id=current_user.id)
    db.delete(db_item)
    try:
        db.commit()
        return {"detail": "Motivation deleted successfully"}
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Cannot delete: the motivation is already used in some answers or questions.")
