from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import models
from dependencies import get_db, require_admin

router = APIRouter(prefix="/api/admin/questions", tags=["Questions"])

# --- SCHEMA PYDANTIC ---
class QuestionBase(BaseModel):
    id: str
    parameter_id: str
    text: str
    instruction: Optional[str] = None
    is_stop_question: bool = False


# --- ENDPOINT ---
@router.get("")
def get_admin_questions(db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    """Recupera tutte le domande"""
    questions = db.query(models.Question).all()
    return questions


@router.get("/{id}")
def get_admin_question(id: str, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    """Recupera una singola domanda per la modifica"""
    question = db.query(models.Question).filter(models.Question.id == id).first()
    if not question:
        raise HTTPException(status_code=404, detail="Domanda non trovata")
    return question


@router.post("", status_code=status.HTTP_201_CREATED)
def create_admin_question(item: QuestionBase, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    """Crea una nuova domanda"""
    # Verifica che il parametro associato esista nel DB
    param = db.query(models.ParameterDef).filter(models.ParameterDef.id == item.parameter_id).first()
    if not param:
        raise HTTPException(status_code=400, detail="Il parametro associato non esiste.")

    db_item = models.Question(
        id=item.id,
        parameter_id=item.parameter_id,
        text=item.text,
        instruction=item.instruction,
        is_stop_question=item.is_stop_question
    )
    db.add(db_item)
    try:
        db.commit()
        db.refresh(db_item)
        return db_item
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Impossibile creare la domanda. ID duplicato.")


@router.put("/{id}")
def update_admin_question(id: str, item: QuestionBase, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    """Modifica una domanda esistente"""
    db_item = db.query(models.Question).filter(models.Question.id == id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Domanda non trovata")

    # Verifica che il parametro associato esista
    param = db.query(models.ParameterDef).filter(models.ParameterDef.id == item.parameter_id).first()
    if not param:
        raise HTTPException(status_code=400, detail="Il parametro associato non esiste.")

    db_item.id = item.id
    db_item.parameter_id = item.parameter_id
    db_item.text = item.text
    db_item.instruction = item.instruction
    db_item.is_stop_question = item.is_stop_question

    try:
        db.commit()
        db.refresh(db_item)
        return db_item
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Impossibile aggiornare la domanda (ID duplicato).")


@router.delete("/{id}")
def delete_admin_question(id: str, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    """Elimina una domanda"""
    db_item = db.query(models.Question).filter(models.Question.id == id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Domanda non trovata")

    db.delete(db_item)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Impossibile eliminare la domanda: sono presenti record collegati (es. risposte).")
    return {"detail": "Domanda eliminata con successo"}