from typing import Optional, List
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

import models
from dependencies import get_db, require_admin
from services.versioning import record_version

router = APIRouter(prefix="/api/admin/questions", tags=["Questions"])

# --- SCHEMA PYDANTIC ---
class QuestionBase(BaseModel):
    id: str
    parameter_id: str
    text: str
    instruction: Optional[str] = None
    instruction_yes: Optional[str] = None
    instruction_no: Optional[str] = None
    example_yes: Optional[str] = None
    help_info: Optional[str] = None
    is_stop_question: bool = False
    is_active: bool = True
    allowed_motivations: List[int] = []

class QuestionUpdate(QuestionBase):
    change_note: Optional[str] = ""

class QuestionCreate(QuestionBase):
    change_note: Optional[str] = ""

# --- ENDPOINT ---
@router.get("")
def get_admin_questions(db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    questions = (
        db.query(models.Question)
        .join(models.ParameterDef, models.Question.parameter_id == models.ParameterDef.id)
        .order_by(models.ParameterDef.position, models.Question.id)
        .all()
    )
    return questions


@router.get("/{id}")
def get_admin_question(id: str, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    question = db.query(models.Question).options(joinedload(models.Question.allowed_motivations)).filter(models.Question.id == id).first()
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    return {
        "id": question.id,
        "parameter_id": question.parameter_id,
        "text": question.text,
        "instruction": question.instruction,
        "instruction_yes": question.instruction_yes,
        "instruction_no": question.instruction_no,
        "example_yes": question.example_yes,
        "help_info": question.help_info,
        "is_stop_question": question.is_stop_question,
        "is_active": question.is_active,
        "allowed_motivations": [qm.motivation_id for qm in question.allowed_motivations]
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def create_admin_question(item: QuestionCreate, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    param = db.query(models.ParameterDef).filter(models.ParameterDef.id == item.parameter_id).first()
    if not param:
        raise HTTPException(status_code=400, detail="The associated parameter does not exist.")

    db_item = models.Question(
        id=item.id,
        parameter_id=item.parameter_id,
        text=item.text,
        instruction=item.instruction,
        instruction_yes=item.instruction_yes,
        instruction_no=item.instruction_no,
        example_yes=item.example_yes,
        help_info=item.help_info,
        is_active=item.is_active,
        is_stop_question=item.is_stop_question
    )
    db.add(db_item)
    try:
        db.commit()
        db.refresh(db_item)

        if item.allowed_motivations:
            for mot_id in item.allowed_motivations:
                db.add(models.QuestionAllowedMotivation(question_id=db_item.id, motivation_id=mot_id))

        # Registra il log di creazione nel parametro genitore (stessa logica del PUT)
        if item.change_note and item.change_note.strip():
            log = models.ParameterChangeLog(
                parameter_id=item.parameter_id,
                user_id=current_user.id,
                change_note=f"[Question {item.id}] New: {item.change_note.strip()}"
            )
            db.add(log)

        db.commit()
        record_version(db, db_item, operation="create", source="manual",
                       user_id=current_user.id, note=(item.change_note or None))
        db.commit()
        return db_item
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Could not create the question. Duplicate ID.")


@router.put("/{id}")
def update_admin_question(id: str, item: QuestionUpdate, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    db_item = db.query(models.Question).filter(models.Question.id == id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Question not found")

    param = db.query(models.ParameterDef).filter(models.ParameterDef.id == item.parameter_id).first()
    if not param:
        raise HTTPException(status_code=400, detail="The associated parameter does not exist.")

    db_item.id = item.id
    db_item.parameter_id = item.parameter_id
    db_item.text = item.text
    db_item.instruction = item.instruction
    db_item.instruction_yes = item.instruction_yes
    db_item.instruction_no = item.instruction_no
    db_item.example_yes = item.example_yes
    db_item.help_info = item.help_info
    db_item.is_stop_question = item.is_stop_question
    db_item.is_active = item.is_active

    db.query(models.QuestionAllowedMotivation).filter(models.QuestionAllowedMotivation.question_id == db_item.id).delete()

    for mot_id in item.allowed_motivations:
        db.add(models.QuestionAllowedMotivation(question_id=db_item.id, motivation_id=mot_id))

    # Registra il log di modifica nel parametro genitore
    if item.change_note and item.change_note.strip():
        log = models.ParameterChangeLog(
            parameter_id=item.parameter_id,
            user_id=current_user.id,
            change_note=f"[Question {id}] {item.change_note.strip()}"
        )
        db.add(log)

    try:
        db.commit()
        record_version(db, db_item, operation="update", source="manual",
                       user_id=current_user.id, note=(item.change_note or None))
        db.commit()
        return {"detail": "Question updated successfully"}
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Could not update the question.")


@router.patch("/{id}/toggle-active")
def toggle_question_active(id: str, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    """Disattiva o riattiva una domanda senza eliminarla dal DB"""
    db_item = db.query(models.Question).filter(models.Question.id == id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Question not found")

    db_item.is_active = not db_item.is_active

    # Logga automaticamente l'azione sul parametro
    azione = "Reactivated" if db_item.is_active else "Deactivated"
    log = models.ParameterChangeLog(
        parameter_id=db_item.parameter_id,
        user_id=current_user.id,
        change_note=f"[Question {id}] {azione}"
    )
    db.add(log)

    db.commit()
    record_version(db, db_item, operation="update", source="manual",
                   user_id=current_user.id, note=azione)
    db.commit()
    return {"detail": "Question status updated", "is_active": db_item.is_active}