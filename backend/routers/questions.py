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


# ==========================================
# CLONE QUESTION WITH DATA
# Crea una nuova question copiando il contenuto da una sorgente, e copia
# integralmente Answer/Example/AnswerMotivation di tutte le lingue. La nuova
# domanda eredita le allowed_motivations della sorgente. La sorgente resta
# intatta. Il nuovo id viene scelto dal client (default: derivato dal target
# parameter come {target_parameter_id}_Q{prossima_lettera}).
# ==========================================
class QuestionClonePayload(BaseModel):
    source_question_id: str
    target_parameter_id: str
    new_id: Optional[str] = None  # se None il client/server può auto-derivarlo


def _next_question_letter(db: Session, target_parameter_id: str) -> Optional[str]:
    """Trova il prossimo `{paramId}_Q{lettera}` libero a partire da 'a'.

    Stop questions con pattern `_QS{lettera}` non vengono considerate.
    Ritorna None se tutte le 26 lettere sono già usate.
    """
    import re
    rows = db.query(models.Question.id).filter(
        models.Question.parameter_id == target_parameter_id
    ).all()
    pattern = re.compile(rf"^{re.escape(target_parameter_id)}_Q([a-z])")
    used = set()
    for (qid,) in rows:
        m = pattern.match(qid or "")
        if m:
            used.add(m.group(1))
    for i in range(26):
        letter = chr(ord('a') + i)
        if letter not in used:
            return letter
    return None


@router.post("/clone", status_code=status.HTTP_201_CREATED)
def clone_question_with_data(
    payload: QuestionClonePayload,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    src = db.query(models.Question).filter(models.Question.id == payload.source_question_id).first()
    if not src:
        raise HTTPException(status_code=404, detail=f"Source question '{payload.source_question_id}' not found")

    target_param = db.query(models.ParameterDef).filter(models.ParameterDef.id == payload.target_parameter_id).first()
    if not target_param:
        raise HTTPException(status_code=404, detail=f"Target parameter '{payload.target_parameter_id}' not found")

    new_id = (payload.new_id or "").strip()
    if not new_id:
        letter = _next_question_letter(db, target_param.id)
        if not letter:
            raise HTTPException(
                status_code=400,
                detail="Cannot auto-generate an id: all 26 letters are taken in the target parameter.",
            )
        new_id = f"{target_param.id}_Q{letter}"

    if db.query(models.Question.id).filter(models.Question.id == new_id).first():
        raise HTTPException(status_code=409, detail=f"A question with id '{new_id}' already exists.")

    new_q = models.Question(
        id=new_id,
        parameter_id=target_param.id,
        text=src.text,
        template_type=src.template_type,
        instruction=src.instruction,
        instruction_yes=src.instruction_yes,
        instruction_no=src.instruction_no,
        example_yes=src.example_yes,
        help_info=src.help_info,
        is_stop_question=src.is_stop_question,
        is_active=src.is_active,
    )
    db.add(new_q)
    db.flush()

    # allowed_motivations
    src_allowed = db.query(models.QuestionAllowedMotivation).filter(
        models.QuestionAllowedMotivation.question_id == src.id
    ).all()
    for am in src_allowed:
        db.add(models.QuestionAllowedMotivation(question_id=new_q.id, motivation_id=am.motivation_id))

    # Answer + Example + AnswerMotivation, per tutte le lingue
    src_answers = db.query(models.Answer).filter(models.Answer.question_id == src.id).all()
    stats = {"answers": 0, "examples": 0, "motivations": 0, "allowed_motivations": len(src_allowed)}
    for a in src_answers:
        new_a = models.Answer(
            language_id=a.language_id,
            question_id=new_q.id,
            status=a.status,
            response_text=a.response_text,
            comments=a.comments,
        )
        db.add(new_a)
        db.flush()
        stats["answers"] += 1
        for ex in a.examples:
            db.add(models.Example(
                answer_id=new_a.id,
                number=ex.number,
                textarea=ex.textarea,
                transliteration=ex.transliteration,
                gloss=ex.gloss,
                translation=ex.translation,
                reference=ex.reference,
            ))
            stats["examples"] += 1
        for am in a.answer_motivations:
            db.add(models.AnswerMotivation(answer_id=new_a.id, motivation_id=am.motivation_id))
            stats["motivations"] += 1

    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"Could not clone the question: {e.orig}")

    record_version(
        db, new_q, operation="create", source="manual", user_id=current_user.id,
        note=f"Cloned from {src.id} (with data)",
    )
    db.commit()

    return {
        "id": new_q.id,
        "parameter_id": new_q.parameter_id,
        "source_id": src.id,
        "stats": stats,
    }