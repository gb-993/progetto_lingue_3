from __future__ import annotations
from typing import Optional, Tuple

from sqlalchemy.orm import Session
import models

# Considera valide TUTTE le risposte tranne le REJECTED
ALLOWED_STATUSES = (
    "pending",
    "waiting_for_approval",
    "approved",
)

def _get_or_create_lp(lang_id: str, param_id: str, db: Session) -> models.LanguageParameter:
    """
    Garantisce l'esistenza di una riga LanguageParameter per (lang,param).
    Non forza value_orig: può restare NULL (indeterminato).
    """
    obj = db.query(models.LanguageParameter).filter(
        models.LanguageParameter.language_id == lang_id,
        models.LanguageParameter.parameter_id == param_id
    ).first()

    if not obj:
        obj = models.LanguageParameter(
            language_id=lang_id,
            parameter_id=param_id,
            value_orig=None,
            warning_orig=False
        )
        db.add(obj)
        db.commit()
        db.refresh(obj)
    return obj

def is_yes(ans: models.Answer) -> bool:
    return ans.response_text and ans.response_text.strip().lower() == "yes"

def is_no(ans: models.Answer) -> bool:
    return ans.response_text and ans.response_text.strip().lower() == "no"

def consolidate_parameter_for_language(lang_id: str, param_id: str, db: Session) -> Tuple[Optional[str], bool]:
    """
    Calcola il valore ORIGINALE del parametro (+ / - / None) e il warning (solo conflitto).
    L'algoritmo originale è mantenuto INALTERATO.
    """
    # Recupera tutte le domande per questo parametro
    questions = db.query(models.Question).filter(models.Question.parameter_id == param_id).all()
    q_dict = {q.id: q for q in questions}

    # Recupera le risposte valide
    answers = db.query(models.Answer).join(models.Question).filter(
        models.Answer.language_id == lang_id,
        models.Question.parameter_id == param_id,
        models.Answer.status.in_(ALLOWED_STATUSES)
    ).all()

    ans_dict = {a.question_id: a for a in answers}

    # Dividiamo normali e stop
    norm_qs = [q for q in questions if not q.is_stop_question]
    stop_qs = [q for q in questions if q.is_stop_question]

    norm_answers = [ans_dict[q.id] for q in norm_qs if q.id in ans_dict]
    stop_answers = [ans_dict[q.id] for q in stop_qs if q.id in ans_dict]

    # --- INIZIO LOGICA ORIGINALE INALTERATA ---
    has_norm_yes = any(is_yes(a) for a in norm_answers)
    has_stop_yes = any(is_yes(a) for a in stop_answers)

    if has_norm_yes:
        if has_stop_yes:
            return "+", True  # Conflitto
        return "+", False

    if has_stop_yes:
        return "-", False

    norm_q_ids = {q.id for q in norm_qs}
    answered_normals = {a.question_id for a in norm_answers}

    if answered_normals != norm_q_ids:
        return None, False

    if all(is_no(a) for a in norm_answers):
        return "-", False

    return None, False
    # --- FINE LOGICA ORIGINALE ---


def recompute_and_persist_language_parameter(language_id: str, parameter_id: str, db: Session) -> Optional[models.LanguageParameter]:
    """
    Punto di ingresso: ricalcola e salva value_orig/warning_orig di (language, parameter).
    """
    # select_for_update di SQLAlchemy per evitare race conditions
    lang = db.query(models.Language).with_for_update().filter(models.Language.id == language_id).first()
    if not lang:
        return None

    param = db.query(models.ParameterDef).filter(models.ParameterDef.id == parameter_id).first()
    if not param:
        return None

    lp = _get_or_create_lp(language_id, parameter_id, db)
    value, warning = consolidate_parameter_for_language(language_id, parameter_id, db)

    lp.value_orig = value
    lp.warning_orig = warning
    db.commit()
    db.refresh(lp)

    return lp