from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, not_

import models
from dependencies import get_db, require_admin, get_current_user

router = APIRouter(prefix="/api", tags=["Dashboard"])


def _user_label(u: models.User | None) -> dict | None:
    if u is None:
        return None
    full = (f"{u.name or ''} {u.surname or ''}").strip() or u.email
    return {"id": u.id, "name": full, "email": u.email}


@router.get("/admin/dashboard")
def get_admin_dashboard(db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    """
    Aggrega tutto il necessario per il pannello admin:
      - to_review: lingue in waiting_for_approval
      - completed: lingue in approved
      - red_by_language: per ogni lingua attiva, parametri "rossi" (unsure o incompleti)
      - recent_changes: cronologia ParameterChangeLog (ultime 50, escluse le note di test/DEACTIVATED)
    """
    # ---- 1. Lingue da revisionare ----
    to_review_rows = db.query(models.Language).options(
        joinedload(models.Language.assigned_user)
    ).filter(
        models.Language.status == "waiting_for_approval"
    ).order_by(models.Language.submitted_at.asc().nullslast()).all()

    to_review = [{
        "id": l.id,
        "name_full": l.name_full,
        "family": l.family,
        "submitted_at": l.submitted_at.isoformat() if l.submitted_at else None,
        "assigned_user": _user_label(l.assigned_user),
    } for l in to_review_rows]

    # ---- 2. Lingue completate ----
    completed_rows = db.query(models.Language).options(
        joinedload(models.Language.assigned_user)
    ).filter(
        models.Language.status == "approved"
    ).order_by(models.Language.reviewed_at.desc().nullslast()).all()

    completed = [{
        "id": l.id,
        "name_full": l.name_full,
        "family": l.family,
        "reviewed_at": l.reviewed_at.isoformat() if l.reviewed_at else None,
        "assigned_user": _user_label(l.assigned_user),
    } for l in completed_rows]

    # ---- 3. Parametri rossi per lingua (escludendo le approved che sono già "verdi") ----
    active_languages = db.query(models.Language).options(
        joinedload(models.Language.assigned_user)
    ).filter(
        models.Language.status != "approved"
    ).order_by(models.Language.position).all()

    active_params = db.query(models.ParameterDef).filter(
        models.ParameterDef.is_active == True
    ).order_by(models.ParameterDef.position).all()

    # Conteggio domande attive per parametro
    qcount_rows = db.query(
        models.Question.parameter_id,
        func.count(models.Question.id)
    ).filter(
        models.Question.is_active == True
    ).group_by(models.Question.parameter_id).all()
    qcount_by_param = {pid: c for pid, c in qcount_rows}

    # Flag unsure (LanguageParameterStatus)
    unsure_rows = db.query(
        models.LanguageParameterStatus.language_id,
        models.LanguageParameterStatus.parameter_id,
    ).filter(
        models.LanguageParameterStatus.is_unsure == True
    ).all()
    unsure_set = {(l, p) for l, p in unsure_rows}

    # Conteggio risposte testuali per (lingua, parametro)
    answered_rows = db.query(
        models.Answer.language_id,
        models.Question.parameter_id,
        func.count(models.Answer.id)
    ).join(
        models.Question, models.Question.id == models.Answer.question_id
    ).filter(
        models.Answer.response_text.isnot(None),
        models.Question.is_active == True
    ).group_by(
        models.Answer.language_id, models.Question.parameter_id
    ).all()
    answered_count = {(lang, param): cnt for lang, param, cnt in answered_rows}

    red_by_language = []
    for lang in active_languages:
        red_params = []
        for p in active_params:
            total_q = qcount_by_param.get(p.id, 0)
            if total_q == 0:
                continue  # parametro senza domande attive: skip
            ans_q = answered_count.get((lang.id, p.id), 0)
            is_unsure = (lang.id, p.id) in unsure_set
            is_incomplete = ans_q < total_q
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

    # ---- 3.5 Conteggio lingue per status + elenco lingue per status ----
    status_counts_rows = db.query(
        models.Language.status,
        func.count(models.Language.id),
    ).group_by(models.Language.status).all()
    status_counts = {s: c for s, c in status_counts_rows}

    all_langs_rows = db.query(
        models.Language.id,
        models.Language.name_full,
        models.Language.status,
    ).order_by(models.Language.position).all()

    languages_by_status: dict[str, list[dict]] = {
        "pending": [],
        "waiting_for_approval": [],
        "approved": [],
        "rejected": [],
    }
    for lid, lname, lstatus in all_langs_rows:
        if lstatus in languages_by_status:
            languages_by_status[lstatus].append({"id": lid, "name_full": lname})

    # ---- 4. Cronologia delle modifiche ----
    changes_rows = db.query(models.ParameterChangeLog).options(
        joinedload(models.ParameterChangeLog.user),
        joinedload(models.ParameterChangeLog.parameter),
    ).filter(
        models.ParameterChangeLog.change_note != "Modifica di test",
        not_(models.ParameterChangeLog.change_note.startswith("Nuova domanda di test")),
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
                "pending": status_counts.get("pending", 0),
                "waiting_for_approval": status_counts.get("waiting_for_approval", 0),
                "approved": status_counts.get("approved", 0),
                "rejected": status_counts.get("rejected", 0),
            },
        }
    }


# ---- Dashboard utente normale: lingue assegnate con stato e progress ----
@router.get("/user/dashboard")
def get_user_dashboard(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    """
    Mostra all'utente le sue lingue assegnate con status, progress (% answered) e nota di rifiuto se applicabile.
    """
    langs = db.query(models.Language).filter(
        models.Language.assigned_user_id == current_user.id
    ).order_by(models.Language.position).all()

    # Domande attive totali (denominatore comune)
    total_active_q = db.query(func.count(models.Question.id)).filter(
        models.Question.is_active == True
    ).scalar() or 0

    # Risposte testuali per ogni lingua dell'utente
    answered_by_lang: dict[str, int] = {}
    if langs:
        answered_rows = db.query(
            models.Answer.language_id,
            func.count(models.Answer.id)
        ).join(
            models.Question, models.Question.id == models.Answer.question_id
        ).filter(
            models.Answer.response_text.isnot(None),
            models.Question.is_active == True,
            models.Answer.language_id.in_([l.id for l in langs])
        ).group_by(models.Answer.language_id).all()
        answered_by_lang = {lang_id: cnt for lang_id, cnt in answered_rows}

    languages = []
    for l in langs:
        ans = answered_by_lang.get(l.id, 0)
        languages.append({
            "id": l.id,
            "name_full": l.name_full,
            "family": l.family,
            "status": l.status,
            "rejection_note": l.rejection_note,
            "answered": ans,
            "total": total_active_q,
            "progress_pct": round(100 * ans / total_active_q) if total_active_q else 0,
            "submitted_at": l.submitted_at.isoformat() if l.submitted_at else None,
            "reviewed_at": l.reviewed_at.isoformat() if l.reviewed_at else None,
        })

    return {"languages": languages}
