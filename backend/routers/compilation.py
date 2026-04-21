from typing import List, Optional, Dict
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func
import models
from dependencies import get_db, get_current_user, require_admin

router = APIRouter(prefix="/api/languages", tags=["Compilation & Workflow"])

# --- SCHEMI PYDANTIC ---
class ExampleInput(BaseModel):
    id: Optional[int] = None
    textarea: str = ""
    transliteration: str = ""
    gloss: str = ""
    translation: str = ""
    reference: str = ""

class QuestionAnswerPayload(BaseModel):
    question_id: str
    response_text: str
    comments: str = ""
    motivation_ids: List[int] = []
    examples: List[ExampleInput] = []

class ParameterBlockSavePayload(BaseModel):
    answers: List[QuestionAnswerPayload]
    is_unsure: bool

# --- ENDPOINT: LETTURA DATI COMPILAZIONE ---
@router.get("/{lang_id}/compilation")
def get_language_compilation_data(lang_id: str, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    language = db.query(models.Language).filter(func.lower(models.Language.id) == lang_id.lower()).first()
    if not language: raise HTTPException(status_code=404, detail="Lingua non trovata")

    parameters = db.query(models.ParameterDef).filter(models.ParameterDef.is_active == True).order_by(models.ParameterDef.position).all()
    answers = db.query(models.Answer).filter(models.Answer.language_id == language.id).all()
    ans_dict = {a.question_id: a for a in answers}

    # Carica gli stati "unsure" dei parametri
    statuses = db.query(models.LanguageParameterStatus).filter(models.LanguageParameterStatus.language_id == language.id).all()
    status_dict = {s.parameter_id: s.is_unsure for s in statuses}

    result = {
        "language": {"id": language.id, "name_full": language.name_full},
        "parameters": []
    }

    for p in parameters:
        total_q = len(p.questions)
        answered_q = sum(1 for q in p.questions if q.id in ans_dict and ans_dict[q.id].response_text)

        param_data = {
            "id": p.id,
            "name": p.name,
            "short_description": p.short_description,
            "stats": {"answered": answered_q, "total": total_q},
            "is_flagged": status_dict.get(p.id, False),
            "questions": []
        }
        for q in p.questions:
            q_data = {
                "id": q.id, "text": q.text, "instruction": q.instruction,
                "instruction_yes": q.instruction_yes, "instruction_no": q.instruction_no,
                "allowed_motivations": [{"id": am.motivation.id, "label": am.motivation.label} for am in q.allowed_motivations],
                "answer": None
            }
            if q.id in ans_dict:
                ans = ans_dict[q.id]
                q_data["answer"] = {
                    "response_text": ans.response_text, "comments": ans.comments,
                    "motivation_ids": [m.motivation_id for m in ans.answer_motivations],
                    "examples": [{"id": ex.id, "textarea": ex.textarea, "transliteration": ex.transliteration, "gloss": ex.gloss, "translation": ex.translation, "reference": ex.reference} for ex in ans.examples]
                }
            param_data["questions"].append(q_data)
        result["parameters"].append(param_data)
    return result

# --- ENDPOINT: SALVATAGGIO MASSIVO PARAMETRO ---
@router.post("/{lang_id}/parameters/{param_id}/save_block")
def save_parameter_block(lang_id: str, param_id: str, payload: ParameterBlockSavePayload, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    language = db.query(models.Language).filter(func.lower(models.Language.id) == lang_id.lower()).first()
    if not language: raise HTTPException(status_code=404, detail="Lingua non trovata")

    # 1. Aggiorna o crea il flag Unsure
    status_entry = db.query(models.LanguageParameterStatus).filter(
        models.LanguageParameterStatus.language_id == language.id,
        models.LanguageParameterStatus.parameter_id == param_id
    ).first()
    if not status_entry:
        status_entry = models.LanguageParameterStatus(language_id=language.id, parameter_id=param_id)
        db.add(status_entry)
    status_entry.is_unsure = payload.is_unsure

    # 2. Salva tutte le risposte fornite
    for ans_payload in payload.answers:
        answer = db.query(models.Answer).filter(
            models.Answer.language_id == language.id,
            models.Answer.question_id == ans_payload.question_id
        ).first()
        if not answer:
            answer = models.Answer(language_id=language.id, question_id=ans_payload.question_id)
            db.add(answer)

        answer.response_text = ans_payload.response_text
        answer.comments = ans_payload.comments

        # Pulisci e ricrea motivazioni/esempi
        db.query(models.AnswerMotivation).filter(models.AnswerMotivation.answer_id == answer.id).delete()
        if ans_payload.response_text == "no":
            for mid in ans_payload.motivation_ids:
                db.add(models.AnswerMotivation(answer_id=answer.id, motivation_id=mid))

        db.query(models.Example).filter(models.Example.answer_id == answer.id).delete()
        if ans_payload.response_text == "yes":
            for ex in ans_payload.examples:
                if ex.textarea.strip():
                    db.add(models.Example(answer_id=answer.id, **ex.dict(exclude={'id'})))

    db.commit()
    return {"detail": "Parametro salvato correttamente"}

# --- WORKFLOW ENDPOINTS (Invariati) ---
@router.post("/{lang_id}/workflow/submit")
def submit_language(lang_id: str, db: Session = Depends(get_db)):
    language = db.query(models.Language).filter(func.lower(models.Language.id) == lang_id.lower()).first()
    db.query(models.Answer).filter(models.Answer.language_id == language.id, models.Answer.status == 'pending').update({"status": "waiting_for_approval"})
    db.commit()
    return {"detail": "Inviato"}

@router.post("/{lang_id}/workflow/approve")
def approve_language(lang_id: str, db: Session = Depends(get_db)):
    language = db.query(models.Language).filter(func.lower(models.Language.id) == lang_id.lower()).first()
    db.query(models.Answer).filter(models.Answer.language_id == language.id, models.Answer.status == 'waiting_for_approval').update({"status": "approved"})
    db.commit()
    return {"detail": "Approvato"}