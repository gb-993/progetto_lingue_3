from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

import models
from dependencies import get_db, require_admin

router = APIRouter(prefix="/api/admin/questions", tags=["Questions"])

# --- SCHEMA PYDANTIC ---
class QuestionBase(BaseModel):
    id: str
    parameter_id: str
    text: str
    instruction: Optional[str] = None
    instruction_yes: Optional[str] = None  # <-- AGGIUNTO
    instruction_no: Optional[str] = None   # <-- AGGIUNTO
    is_stop_question: bool = False
    allowed_motivations: List[int] = []


# --- ENDPOINT ---
@router.get("")
def get_admin_questions(db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    questions = db.query(models.Question).all()
    return questions


@router.get("/{id}")
def get_admin_question(id: str, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    question = db.query(models.Question).options(joinedload(models.Question.allowed_motivations)).filter(models.Question.id == id).first()
    if not question:
        raise HTTPException(status_code=404, detail="Domanda non trovata")

    return {
        "id": question.id,
        "parameter_id": question.parameter_id,
        "text": question.text,
        "instruction": question.instruction,
        "instruction_yes": question.instruction_yes, # <-- AGGIUNTO
        "instruction_no": question.instruction_no,   # <-- AGGIUNTO
        "is_stop_question": question.is_stop_question,
        "allowed_motivations": [qm.motivation_id for qm in question.allowed_motivations]
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def create_admin_question(item: QuestionBase, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    param = db.query(models.ParameterDef).filter(models.ParameterDef.id == item.parameter_id).first()
    if not param:
        raise HTTPException(status_code=400, detail="Il parametro associato non esiste.")

    db_item = models.Question(
        id=item.id,
        parameter_id=item.parameter_id,
        text=item.text,
        instruction=item.instruction,
        instruction_yes=item.instruction_yes, # <-- AGGIUNTO
        instruction_no=item.instruction_no,   # <-- AGGIUNTO
        is_stop_question=item.is_stop_question
    )
    db.add(db_item)
    try:
        db.commit()
        db.refresh(db_item)

        if item.allowed_motivations:
            for mot_id in item.allowed_motivations:
                db.add(models.QuestionAllowedMotivation(question_id=db_item.id, motivation_id=mot_id))
            db.commit()

        return db_item
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Impossibile creare la domanda. ID duplicato.")


@router.put("/{id}")
def update_admin_question(id: str, item: QuestionBase, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    db_item = db.query(models.Question).filter(models.Question.id == id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Domanda non trovata")

    param = db.query(models.ParameterDef).filter(models.ParameterDef.id == item.parameter_id).first()
    if not param:
        raise HTTPException(status_code=400, detail="Il parametro associato non esiste.")

    db_item.id = item.id
    db_item.parameter_id = item.parameter_id
    db_item.text = item.text
    db_item.instruction = item.instruction
    db_item.instruction_yes = item.instruction_yes # <-- AGGIUNTO
    db_item.instruction_no = item.instruction_no   # <-- AGGIUNTO
    db_item.is_stop_question = item.is_stop_question

    db.query(models.QuestionAllowedMotivation).filter(models.QuestionAllowedMotivation.question_id == db_item.id).delete()

    for mot_id in item.allowed_motivations:
        db.add(models.QuestionAllowedMotivation(question_id=db_item.id, motivation_id=mot_id))

    try:
        db.commit()
        return {"detail": "Domanda aggiornata con successo"}
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Impossibile aggiornare la domanda.")


@router.delete("/{id}")
def delete_admin_question(id: str, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
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