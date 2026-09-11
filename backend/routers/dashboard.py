from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, not_

import models
from dependencies import get_db, require_admin, get_current_user
from services.param_consolidate import ALLOWED_STATUSES
from services.param_state import (
    GREEN,
    RED,
    active_param_questions,
    compute_colors,
    language_completion_from_colors,
)

router = APIRouter(prefix="/api", tags=["Dashboard"])


def _user_label(u: models.User | None) -> dict | None:
    if u is None:
        return None
    full = (f"{u.name or ''} {u.surname or ''}").strip() or u.email
    return {"id": u.id, "name": full, "email": u.email}


@router.get("/admin/dashboard")
def get_admin_dashboard(db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):

    to_review_rows = db.query(models.Language).options(
        joinedload(models.Language.assigned_user)
    ).filter(
        models.Language.status == "submitted"
    ).order_by(models.Language.submitted_at.asc().nullslast()).all()

    to_review = [{
        "id": l.id,
        "name_full": l.name_full,
        "family": l.family,
        "submitted_at": l.submitted_at.isoformat() if l.submitted_at else None,
        "assigned_user": _user_label(l.assigned_user),
    } for l in to_review_rows]

    completed_rows = db.query(models.Language).options(
        joinedload(models.Language.assigned_user)
    ).filter(
        models.Language.status == "validated"
    ).order_by(models.Language.reviewed_at.desc().nullslast()).all()

    completed = [{
        "id": l.id,
        "name_full": l.name_full,
        "family": l.family,
        "reviewed_at": l.reviewed_at.isoformat() if l.reviewed_at else None,
        "assigned_user": _user_label(l.assigned_user),
    } for l in completed_rows]

    red_candidate_languages = db.query(models.Language).options(
        joinedload(models.Language.assigned_user)
    ).order_by(func.lower(models.Language.id)).all()

    active_params = db.query(models.ParameterDef).filter(
        models.ParameterDef.is_active == True
    ).order_by(models.ParameterDef.position).all()

    # Un parametro e' rosso quando lo dice param_state, cioe' la stessa regola
    # che colora i quadratini nella pagina della lingua: almeno una domanda
    # senza risposta o marcata 'unsure', su un parametro gia' iniziato.
    answerable_questions = {
        param_id: question_ids
        for param_id, question_ids in active_param_questions(db).items()
        if question_ids
    }
    colors = compute_colors(db, [l.id for l in red_candidate_languages], answerable_questions)

    unsure_rows = db.query(
        models.LanguageParameterStatus.language_id,
        models.LanguageParameterStatus.parameter_id,
    ).filter(
        models.LanguageParameterStatus.is_unsure == True
    ).all()
    unsure_set = {(l, p) for l, p in unsure_rows}

    # Conteggio per il testo "incomplete (n/m)": contano solo le risposte vere e
    # non respinte, come nel consolidamento. 'unsure' e 'missing' non risolvono.
    answered_rows = db.query(
        models.Answer.language_id,
        models.Question.parameter_id,
        func.count(models.Answer.id)
    ).join(
        models.Question, models.Question.id == models.Answer.question_id
    ).filter(
        models.Answer.response_text.in_(["yes", "no"]),
        models.Answer.status.in_(ALLOWED_STATUSES),
        models.Question.is_active == True
    ).group_by(
        models.Answer.language_id, models.Question.parameter_id
    ).all()
    answered_count = {(lang, param): cnt for lang, param, cnt in answered_rows}

    red_by_language = []
    for lang in red_candidate_languages:
        red_params = []
        for p in active_params:
            question_ids = answerable_questions.get(p.id)
            if not question_ids:
                continue  # parametro senza domande attive: skip
            total_q = len(question_ids)
            ans_q = answered_count.get((lang.id, p.id), 0)
            is_unsure = (lang.id, p.id) in unsure_set
            is_incomplete = colors.get((lang.id, p.id)) == RED
            if not (is_unsure or is_incomplete):
                continue
            reasons = []
            if is_unsure:
                reasons.append("unsure")
            if is_incomplete:
                reasons.append(f"incomplete ({ans_q}/{total_q})")
            red_params.append({
                "id": p.id,
                "name": p.name,
                "answered": ans_q,
                "total": total_q,
                "is_unsure": is_unsure,
                "is_incomplete": is_incomplete,
                "reasons": reasons,
            })
        if red_params:
            red_by_language.append({
                "language_id": lang.id,
                "language_name": lang.name_full,
                "language_status": lang.status,
                "assigned_user": _user_label(lang.assigned_user),
                "red_count": len(red_params),
                "params": red_params,
            })

    status_counts_rows = db.query(
        models.Language.status,
        func.count(models.Language.id),
    ).group_by(models.Language.status).all()
    status_counts = {s: c for s, c in status_counts_rows}

    all_langs_rows = db.query(
        models.Language.id,
        models.Language.name_full,
        models.Language.status,
    ).order_by(func.lower(models.Language.id)).all()

    languages_by_status: dict[str, list[dict]] = {
        "draft": [],
        "submitted": [],
        "validated": [],
    }
    for lid, lname, lstatus in all_langs_rows:
        if lstatus in languages_by_status:
            languages_by_status[lstatus].append({"id": lid, "name_full": lname})

    changes_rows = db.query(models.ParameterChangeLog).options(
        joinedload(models.ParameterChangeLog.user),
        joinedload(models.ParameterChangeLog.parameter),
    ).filter(
        not_(models.ParameterChangeLog.change_note.startswith("Test edit")),
        not_(models.ParameterChangeLog.change_note.startswith("Test new question")),
        not_(models.ParameterChangeLog.change_note.startswith("DEACTIVATED")),
    ).order_by(models.ParameterChangeLog.created_at.desc()).limit(50).all()

    recent_changes = [{
        "id": c.id,
        "parameter_id": c.parameter_id,
        "parameter_name": c.parameter.name if c.parameter else "(deleted)",
        "change_note": c.change_note,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "user": _user_label(c.user),
    } for c in changes_rows]

    return {
        "to_review": to_review,
        "completed": completed,
        "red_by_language": red_by_language,
        "recent_changes": recent_changes,
        "languages_by_status": languages_by_status,
        "stats": {
            "to_review_count": len(to_review),
            "completed_count": len(completed),
            "languages_with_red": len(red_by_language),
            "total_red_params": sum(g["red_count"] for g in red_by_language),
            "by_status": {
                "draft": status_counts.get("draft", 0),
                "submitted": status_counts.get("submitted", 0),
                "validated": status_counts.get("validated", 0),
            },
        }
    }


@router.get("/user/dashboard")
def get_user_dashboard(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    """
    Mostra all'utente le sue lingue assegnate con status, completamento (parametri verdi sul totale) e nota di rifiuto se applicabile.
    """
    langs = db.query(models.Language).filter(
        models.Language.assigned_user_id == current_user.id
    ).order_by(func.lower(models.Language.id)).all()

    # Stessa base di calcolo del badge di completamento nella lista lingue: solo
    # i parametri attivi che hanno almeno una question attiva. Contare invece le
    # singole risposte darebbe una percentuale che non raggiunge mai il 100%.
    answerable_questions = {
        param_id: question_ids
        for param_id, question_ids in active_param_questions(db).items()
        if question_ids
    }
    total_params = len(answerable_questions)
    colors = compute_colors(db, [l.id for l in langs], answerable_questions)

    languages = []
    for l in langs:
        param_colors = [colors[(l.id, param_id)] for param_id in answerable_questions]
        complete_params = sum(1 for color in param_colors if color == GREEN)
        languages.append({
            "id": l.id,
            "name_full": l.name_full,
            "family": l.family,
            "status": l.status,
            "completion": l.completion_override or language_completion_from_colors(param_colors),
            "completion_forced": l.completion_override is not None,
            "rejection_note": l.rejection_note,
            "complete_params": complete_params,
            "total_params": total_params,
            "progress_pct": round(100 * complete_params / total_params) if total_params else 0,
            "submitted_at": l.submitted_at.isoformat() if l.submitted_at else None,
            "reviewed_at": l.reviewed_at.isoformat() if l.reviewed_at else None,
        })

    return {"languages": languages}
