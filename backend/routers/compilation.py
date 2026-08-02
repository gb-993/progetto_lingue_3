import logging
from typing import List, Optional, Dict
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from time_utils import utc_now
from pydantic import BaseModel
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import func, or_
import models
from database import SessionLocal
from dependencies import get_db, get_current_user, require_admin, require_super_admin
from services.logic_parser import evaluate_with_parser
from services.dag_eval import run_dag_for_language
from services.param_consolidate import recompute_and_persist_language_parameter
from services.versioning import record_version, serialize_entity
from services.param_state import param_color, language_completion_from_colors

logger = logging.getLogger(__name__)


def _run_dag_in_background(language_id: str) -> None:

    db = SessionLocal()
    try:
        run_dag_for_language(language_id, db)
        db.commit()
    except Exception as e:
        db.rollback()
        logger.error("DAG background run failed for language %s: %s", language_id, e, exc_info=True)
    finally:
        db.close()


def _ensure_can_modify(language: models.Language, current_user: models.User):

    if current_user.role == "admin":
        return
    if language.assigned_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="You are not authorized to modify this language.")
    if language.status != "draft":
        raise HTTPException(
            status_code=409,
            detail=f"Language locked (status: {language.status}). Wait for the admin review.",
        )


router = APIRouter(prefix="/api/languages", tags=["Compilation & Workflow"])

# --- SCHEMI PYDANTIC ---
class ExampleInput(BaseModel):
    id: Optional[int] = None
    number: str = ""
    textarea: str = ""
    transliteration: str = ""
    gloss: str = ""
    translation: str = ""
    reference: str = ""
    is_test: bool = False

class QuestionAnswerPayload(BaseModel):
    question_id: str
    response_text: str
    comments: str = ""
    motivation_ids: List[int] = []
    examples: List[ExampleInput] = []

class ParameterBlockSavePayload(BaseModel):
    answers: List[QuestionAnswerPayload]
    is_unsure: bool
    admin_note: Optional[str] = None
    expected_last_modified: Optional[str] = None

@router.get("/examples/search")
def search_examples(
    q: str = "",
    language_id: Optional[str] = None,
    limit: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):

    base = db.query(
        models.Example.id,
        models.Example.textarea,
        models.Example.transliteration,
        models.Example.gloss,
        models.Example.translation,
        models.Example.reference,
        models.Answer.language_id,
        models.Answer.question_id,
        models.Language.name_full,
    ).join(
        models.Answer, models.Answer.id == models.Example.answer_id
    ).join(
        models.Language, models.Language.id == models.Answer.language_id
    ).filter(
        models.Example.textarea.isnot(None),
        models.Example.textarea != "",
    )

    if language_id:
        base = base.filter(models.Answer.language_id == language_id)

    q = (q or "").strip()
    if q:
        like = f"%{q}%"
        base = base.filter(or_(
            models.Example.textarea.ilike(like),
            models.Example.translation.ilike(like),
            models.Example.gloss.ilike(like),
        ))

    base = base.order_by(func.lower(models.Language.id), models.Example.id)

    if language_id:
        if limit is not None:
            base = base.limit(max(1, int(limit)))
    else:
        effective_limit = max(1, min(int(limit or 50), 200))
        base = base.limit(effective_limit)

    rows = base.all()

    return [{
        "id": r.id,
        "textarea": r.textarea or "",
        "transliteration": r.transliteration or "",
        "gloss": r.gloss or "",
        "translation": r.translation or "",
        "reference": r.reference or "",
        "language_id": r.language_id,
        "language_name": r.name_full,
        "question_id": r.question_id,
    } for r in rows]


@router.get("/{lang_id}/compilation")
def get_language_compilation_data(lang_id: str, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    language = db.query(models.Language).filter(models.Language.id == lang_id).first()
    if not language: raise HTTPException(status_code=404, detail="Language not found")

    parameters = (
        db.query(models.ParameterDef)
        .filter(models.ParameterDef.is_active == True)
        .order_by(models.ParameterDef.position)
        .options(
            selectinload(models.ParameterDef.questions)
            .selectinload(models.Question.allowed_motivations)
            .selectinload(models.QuestionAllowedMotivation.motivation)
        )
        .all()
    )
    answers = (
        db.query(models.Answer)
        .filter(models.Answer.language_id == language.id)
        .options(
            selectinload(models.Answer.answer_motivations),
            selectinload(models.Answer.examples),
        )
        .all()
    )
    ans_dict = {a.question_id: a for a in answers}

    statuses = db.query(models.LanguageParameterStatus).filter(models.LanguageParameterStatus.language_id == language.id).all()
    status_dict = {s.parameter_id: s.is_unsure for s in statuses}
    needs_review_dict = {s.parameter_id: bool(s.needs_review) for s in statuses}
    is_admin = current_user.role == "admin"
    admin_note_dict = {s.parameter_id: (s.admin_note or "") for s in statuses} if is_admin else {}

    result = {
        "language": {
            "id": language.id,
            "name_full": language.name_full,
            "status": language.status,
            "rejection_note": language.rejection_note,
            "submitted_at": language.submitted_at.isoformat() if language.submitted_at else None,
            "reviewed_at": language.reviewed_at.isoformat() if language.reviewed_at else None,
            "assigned_user_id": language.assigned_user_id,
            "assigned_user": (
                {
                    "id": language.assigned_user.id,
                    "name": language.assigned_user.name,
                    "surname": language.assigned_user.surname,
                }
                if language.assigned_user else None
            ),
            "top_level_family": language.top_level_family,
            "family": language.family,
            "grp": language.grp,
            "historical_language": language.historical_language,
            "isocode": language.isocode,
            "glottocode": language.glottocode,
            "location": language.location,
            "latitude": float(language.latitude) if language.latitude is not None else None,
            "longitude": float(language.longitude) if language.longitude is not None else None,
            "supervisor": language.supervisor,
            "informant": language.informant,
            "source": language.source,
            "completion_override": language.completion_override,
        },
        "parameters": []
    }

    answerable_colors: list[str] = []

    for p in parameters:
        active_questions = sorted(
            (q for q in p.questions if q.is_active),
            key=lambda x: (x.is_stop_question, x.id),
        )
        total_q = len(active_questions)
        answered_q = sum(
            1 for q in active_questions
            if q.id in ans_dict and ans_dict[q.id].response_text in ("yes", "no")
        )

        block_last_modified = None
        for q in active_questions:
            if q.id in ans_dict:
                u = ans_dict[q.id].updated_at
                if u is not None and (block_last_modified is None or u > block_last_modified):
                    block_last_modified = u

        qids = [q.id for q in active_questions]
        response_by_qid = {
            q.id: (ans_dict[q.id].response_text if q.id in ans_dict else None)
            for q in active_questions
        }
        example_count_by_qid = {}
        has_test_example = False
        for q in active_questions:
            if q.id in ans_dict:
                exs = ans_dict[q.id].examples
                example_count_by_qid[q.id] = sum(1 for ex in exs if (ex.textarea or "").strip())
                if any(ex.is_test for ex in exs):
                    has_test_example = True
        color = param_color(
            qids, response_by_qid, example_count_by_qid,
            has_test_example, needs_review_dict.get(p.id, False),
        )
        if total_q > 0:
            answerable_colors.append(color)

        param_data = {
            "id": p.id,
            "name": p.name,
            "short_description": p.short_description,
            "stats": {"answered": answered_q, "total": total_q},
            "is_flagged": status_dict.get(p.id, False),
            "color": color,
            "needs_review": needs_review_dict.get(p.id, False),
            "last_modified": block_last_modified.isoformat() if block_last_modified else None,
            "questions": []
        }
        if is_admin:
            param_data["admin_note"] = admin_note_dict.get(p.id, "")
        for q in active_questions:
            q_data = {
                "id": q.id, "text": q.text, "instruction": q.instruction,
                "instruction_yes": q.instruction_yes, "instruction_no": q.instruction_no,
                "example_yes": q.example_yes, "help_info": q.help_info,
                "allowed_motivations": [{"id": am.motivation.id, "label": am.motivation.label} for am in q.allowed_motivations],
                "answer": None
            }
            if q.id in ans_dict:
                ans = ans_dict[q.id]
                q_data["answer"] = {
                    "response_text": ans.response_text or "",
                    "comments": ans.comments or "",
                    "motivation_ids": [m.motivation_id for m in ans.answer_motivations],
                    "examples": [{
                        "id": ex.id,
                        "number": ex.number or "",
                        "textarea": ex.textarea or "",
                        "transliteration": ex.transliteration or "",
                        "gloss": ex.gloss or "",
                        "translation": ex.translation or "",
                        "reference": ex.reference or "",
                        "is_test": bool(ex.is_test),
                    } for ex in sorted(ans.examples, key=lambda e: e.id)]
                }
            param_data["questions"].append(q_data)
        result["parameters"].append(param_data)

    result["language"]["completion"] = (
        language.completion_override
        or language_completion_from_colors(answerable_colors)
    )
    return result


@router.get("/{lang_id}/parameters/{param_id}/block")
def get_param_block_for_language(
    lang_id: str,
    param_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):

    language = db.query(models.Language).filter(models.Language.id == lang_id).first()
    if not language:
        raise HTTPException(status_code=404, detail="Language not found")
    parameter = (
        db.query(models.ParameterDef)
        .filter(models.ParameterDef.id == param_id)
        .options(
            selectinload(models.ParameterDef.questions)
            .selectinload(models.Question.allowed_motivations)
            .selectinload(models.QuestionAllowedMotivation.motivation)
        )
        .first()
    )
    if not parameter:
        raise HTTPException(status_code=404, detail="Parameter not found")

    active_questions = sorted(
        (q for q in parameter.questions if q.is_active),
        key=lambda x: (x.is_stop_question, x.id),
    )
    qids = [q.id for q in active_questions]
    answers = []
    if qids:
        answers = (
            db.query(models.Answer)
            .filter(
                models.Answer.language_id == language.id,
                models.Answer.question_id.in_(qids),
            )
            .options(
                selectinload(models.Answer.answer_motivations),
                selectinload(models.Answer.examples),
            )
            .all()
        )
    ans_dict = {a.question_id: a for a in answers}

    status_entry = db.query(models.LanguageParameterStatus).filter(
        models.LanguageParameterStatus.language_id == language.id,
        models.LanguageParameterStatus.parameter_id == param_id,
    ).first()
    is_unsure = status_entry.is_unsure if status_entry else False
    admin_note = (status_entry.admin_note or "") if status_entry else ""

    block_last_modified = None
    for q in active_questions:
        a = ans_dict.get(q.id)
        if a is not None and a.updated_at is not None:
            if block_last_modified is None or a.updated_at > block_last_modified:
                block_last_modified = a.updated_at

    param_data = {
        "id": parameter.id,
        "name": parameter.name,
        "short_description": parameter.short_description,
        "is_flagged": is_unsure,
        "admin_note": admin_note,
        "last_modified": block_last_modified.isoformat() if block_last_modified else None,
        "questions": [],
    }
    for q in active_questions:
        q_data = {
            "id": q.id, "text": q.text, "instruction": q.instruction,
            "instruction_yes": q.instruction_yes, "instruction_no": q.instruction_no,
            "example_yes": q.example_yes, "help_info": q.help_info,
            "allowed_motivations": [{"id": am.motivation.id, "label": am.motivation.label} for am in q.allowed_motivations],
            "answer": None,
        }
        if q.id in ans_dict:
            ans = ans_dict[q.id]
            q_data["answer"] = {
                "response_text": ans.response_text or "",
                "comments": ans.comments or "",
                "motivation_ids": [m.motivation_id for m in ans.answer_motivations],
                "examples": [{
                    "id": ex.id,
                    "number": ex.number or "",
                    "textarea": ex.textarea or "",
                    "transliteration": ex.transliteration or "",
                    "gloss": ex.gloss or "",
                    "translation": ex.translation or "",
                    "reference": ex.reference or "",
                    "is_test": bool(ex.is_test),
                } for ex in sorted(ans.examples, key=lambda e: e.id)]
            }
        param_data["questions"].append(q_data)

    return {
        "language": {
            "id": language.id,
            "name_full": language.name_full,
            "status": language.status,
        },
        "parameter": param_data,
    }


def _block_last_modified_iso(db: Session, language_id: str, param_id: str) -> Optional[str]:
 
    current_max = db.query(func.max(models.Answer.updated_at)).join(
        models.Question, models.Question.id == models.Answer.question_id
    ).filter(
        models.Answer.language_id == language_id,
        models.Question.parameter_id == param_id,
        models.Question.is_active == True,
    ).scalar()
    return current_max.isoformat() if current_max else None


@router.post("/{lang_id}/parameters/{param_id}/save_block")
def save_parameter_block(lang_id: str, param_id: str, payload: ParameterBlockSavePayload, background_tasks: BackgroundTasks, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    language = db.query(models.Language).with_for_update().filter(models.Language.id == lang_id).first()
    if not language: raise HTTPException(status_code=404, detail="Language not found")
    _ensure_can_modify(language, current_user)

    if payload.expected_last_modified is not None:
        current_iso = _block_last_modified_iso(db, language.id, param_id)
        if current_iso != payload.expected_last_modified:
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "stale_block",
                    "message": "This block has been modified by another session (probably an admin). Reload the page to see the changes before saving.",
                    "current_last_modified": current_iso,
                    "expected_last_modified": payload.expected_last_modified,
                }
            )

    status_entry = db.query(models.LanguageParameterStatus).filter(
        models.LanguageParameterStatus.language_id == language.id,
        models.LanguageParameterStatus.parameter_id == param_id
    ).first()
    if not status_entry:
        status_entry = models.LanguageParameterStatus(language_id=language.id, parameter_id=param_id)
        db.add(status_entry)
    status_entry.is_unsure = payload.is_unsure
    status_entry.needs_review = False
    if current_user.role == "admin" and payload.admin_note is not None:
        note = payload.admin_note.strip()
        status_entry.admin_note = note or None

    touched: list[tuple[models.Answer, bool, Optional[dict]]] = []

    for ans_payload in payload.answers:
        normalized_response = ans_payload.response_text if ans_payload.response_text in ("yes", "no", "unsure", "missing") else None

        if normalized_response in ("yes", "unsure"):
            valid_ex_count = sum(1 for ex in ans_payload.examples if ex.textarea.strip())
            if valid_ex_count < 2:
                raise HTTPException(status_code=400, detail={
                    "code": "missing_examples",
                    "question_id": ans_payload.question_id,
                    "message": f"Question {ans_payload.question_id} needs at least 2 valid examples when answering YES or UNSURE.",
                })

        answer = db.query(models.Answer).filter(
            models.Answer.language_id == language.id,
            models.Answer.question_id == ans_payload.question_id
        ).first()

        if not answer and normalized_response is None and not (ans_payload.comments or "").strip():
            continue

        was_new = answer is None
        old_snapshot = None if was_new else serialize_entity(answer)

        if not answer:
            answer = models.Answer(language_id=language.id, question_id=ans_payload.question_id)
            db.add(answer)
            db.flush()

        answer.response_text = normalized_response
        answer.comments = ans_payload.comments

        db.query(models.AnswerMotivation).filter(models.AnswerMotivation.answer_id == answer.id).delete()
        if normalized_response == "no":
            for mid in ans_payload.motivation_ids:
                db.add(models.AnswerMotivation(answer_id=answer.id, motivation_id=mid))

        db.query(models.Example).filter(models.Example.answer_id == answer.id).delete()
        if normalized_response in ("yes", "no", "unsure", "missing"):
            for ex in ans_payload.examples:
                if ex.textarea.strip():
                    db.add(models.Example(answer_id=answer.id, **ex.model_dump(exclude={'id'})))

        touched.append((answer, was_new, old_snapshot))

    db.flush()
    for answer, _, _ in touched:
        db.expire(answer)

    for answer, was_new, old_snapshot in touched:
        new_snapshot = serialize_entity(answer)
        if was_new or new_snapshot != old_snapshot:
            record_version(
                db, answer,
                operation="create" if was_new else "update",
                source="manual",
                user_id=current_user.id,
            )

    db.commit()
    recompute_and_persist_language_parameter(language.id, param_id, db)
    db.commit()

    background_tasks.add_task(_run_dag_in_background, language.id)

    return {
        "detail": "Parameter saved successfully",
        "last_modified": _block_last_modified_iso(db, language.id, param_id)
    }


# --- WORKFLOW ENDPOINTS ---
class NotePayload(BaseModel):
    note: Optional[str] = ""


@router.post("/{lang_id}/workflow/submit")
def submit_language(lang_id: str, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
 
    language = db.query(models.Language).filter(models.Language.id == lang_id).first()
    if not language: raise HTTPException(status_code=404, detail="Language not found")

    if current_user.role == "admin":
        raise HTTPException(status_code=403, detail="Confirm is reserved for the assigned user. Admins validate or send back.")
    if language.assigned_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the user assigned to this language can confirm it.")
    if language.status != "draft":
        raise HTTPException(status_code=409, detail=f"Cannot confirm: current status '{language.status}'.")

    language.status = "submitted"
    language.submitted_at = utc_now()
    language.rejection_note = None  # ripuliamo eventuale nota di rimando precedente
    db.commit()
    return {"detail": "Language confirmed and submitted for review.", "status": language.status}


@router.post("/{lang_id}/workflow/validate")
def validate_language(
    lang_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):

    language = db.query(models.Language).filter(models.Language.id == lang_id).first()
    if not language: raise HTTPException(status_code=404, detail="Language not found")
    if language.status != "submitted":
        raise HTTPException(status_code=409, detail=f"Cannot validate: current status '{language.status}'.")

    language.status = "validated"
    language.reviewed_at = utc_now()
    language.rejection_note = None
    db.commit()
    background_tasks.add_task(_run_dag_in_background, language.id)
    return {"detail": "Language validated.", "status": language.status}


@router.post("/{lang_id}/workflow/send_back")
def send_back_language(lang_id: str, payload: NotePayload, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):

    language = db.query(models.Language).filter(models.Language.id == lang_id).first()
    if not language: raise HTTPException(status_code=404, detail="Language not found")
    if language.status != "submitted":
        raise HTTPException(status_code=409, detail=f"Cannot send back: current status '{language.status}'.")

    language.status = "draft"
    language.reviewed_at = utc_now()
    language.rejection_note = (payload.note or "").strip() or None
    db.commit()
    return {"detail": "Language sent back to the user.", "status": language.status, "rejection_note": language.rejection_note}


@router.post("/{lang_id}/workflow/reopen")
def reopen_language(lang_id: str, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    """
    validated -> draft. Solo admin. Sblocca una lingua già validata per poterla
    modificare di nuovo (esce dalla sola lettura).
    """
    language = db.query(models.Language).filter(models.Language.id == lang_id).first()
    if not language: raise HTTPException(status_code=404, detail="Language not found")
    if language.status != "validated":
        raise HTTPException(status_code=409, detail=f"Cannot reopen: current status '{language.status}'.")

    language.status = "draft"
    language.rejection_note = None
    db.commit()
    return {"detail": "Language reopened.", "status": language.status}


# --- ASSE A: override manuale del completamento (solo super-admin) ---
class CompletionOverridePayload(BaseModel):
    override: Optional[str] = None


_COMPLETION_VALUES = ("empty", "incomplete", "complete")


@router.put("/{lang_id}/completion-override")
def set_completion_override(
    lang_id: str,
    payload: CompletionOverridePayload,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_super_admin),
):

    language = db.query(models.Language).filter(models.Language.id == lang_id).first()
    if not language: raise HTTPException(status_code=404, detail="Language not found")

    ov = (payload.override or "").strip().lower() or None
    if ov is not None and ov not in _COMPLETION_VALUES:
        raise HTTPException(status_code=422, detail=f"Invalid override '{payload.override}'.")

    language.completion_override = ov
    db.commit()
    return {"detail": "Completion override updated.", "completion_override": language.completion_override}


@router.get("/{lang_id}/debug")
def get_language_debug_data(lang_id: str, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    language = db.query(models.Language).filter(models.Language.id == lang_id).first()
    if not language: raise HTTPException(status_code=404, detail="Language not found")

    parameters = db.query(models.ParameterDef).filter(
        models.ParameterDef.is_active == True
    ).order_by(models.ParameterDef.position, models.ParameterDef.id).all()

    answers = db.query(models.Answer).filter(models.Answer.language_id == language.id).all()
    ans_by_qid = {a.question_id: a for a in answers}

    lps = db.query(models.LanguageParameter).filter(models.LanguageParameter.language_id == language.id).all()

    init_by_pid = {}
    warni_by_pid = {}
    final_by_pid = {}
    warnf_by_pid = {}
    cond_values = {} # Dizionario per valutare le condizioni in tempo reale

    for lp in lps:
        pid = lp.parameter_id
        init_by_pid[pid] = lp.value_orig or ""
        warni_by_pid[pid] = bool(lp.warning_orig)
        if lp.eval:
            final_by_pid[pid] = lp.eval.value_eval or ""
            warnf_by_pid[pid] = bool(lp.eval.warning_eval)
            cond_values[pid] = lp.eval.value_eval or lp.value_orig or ""
        else:
            final_by_pid[pid] = ""
            warnf_by_pid[pid] = False
            cond_values[pid] = lp.value_orig or ""

    rows = []
    for p in parameters:
        q_list = []
        for q in sorted(p.questions, key=lambda x: (x.is_stop_question, x.id)):
            a = ans_by_qid.get(q.id)
            ans_label = a.response_text.upper() if (a and a.response_text in ("yes", "no")) else ""
            q_list.append({
                "id": q.id,
                "answer": ans_label,
                "is_active": bool(q.is_active),
            })

        cond_true = None
        if p.implicational_condition:
            try:
                cond_true = evaluate_with_parser(p.implicational_condition, cond_values)
            except Exception:
                cond_true = False

        rows.append({
            "position": p.position,
            "param_id": p.id,
            "name": p.name,
            "questions": q_list,
            "initial": init_by_pid.get(p.id, ""),
            "final": final_by_pid.get(p.id, ""),
            "warn_init": warni_by_pid.get(p.id, False),
            "warn_final": warnf_by_pid.get(p.id, False),
            "cond": p.implicational_condition or "",
            "cond_true": cond_true
        })

    return {
        "language": {"id": language.id, "name_full": language.name_full},
        "rows": rows
    }


@router.post("/{lang_id}/workflow/run_dag")
def run_dag_endpoint(lang_id: str, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):

    language = db.query(models.Language).filter(models.Language.id == lang_id).first()
    if not language: raise HTTPException(status_code=404, detail="Language not found")

    active_params = db.query(models.ParameterDef.id).filter(models.ParameterDef.is_active == True).all()
    for (pid,) in active_params:
        recompute_and_persist_language_parameter(language.id, pid, db)
    db.commit()

    try:
        report = run_dag_for_language(language.id, db)
        db.commit()
        return {
            "detail": f"DAG completed. Processed: {len(report.processed)}, Forced to zero: {len(report.forced_zero)}, Warnings propagated: {len(report.warnings_propagated)}."
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Critical error while running the DAG: {str(e)}")