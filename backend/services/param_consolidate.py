from __future__ import annotations
from typing import Optional, Tuple

from sqlalchemy.orm import Session
from sqlalchemy.exc import NoResultFound
import models

# Tutte le risposte tranne le REJECTED concorrono al consolidamento
ALLOWED_STATUSES = (
    "pending",
    "waiting_for_approval",
    "approved",
)

def _get_or_create_lp(lang_id: str, param_id: str, db: Session) -> models.LanguageParameter:
    """Restituisce la riga LanguageParameter di (lingua, parametro), creandola se manca."""
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
        # flush e non commit: la transazione è gestita dal chiamante
        db.flush()
    return obj

def is_yes(ans: models.Answer) -> bool:
    return ans.response_text is not None and ans.response_text.lower() == "yes"

def is_no(ans: models.Answer) -> bool:
    return ans.response_text is not None and ans.response_text.lower() == "no"

def consolidate_parameter_for_language(lang_id: str, param_id: str, db: Session) -> Tuple[Optional[str], bool]:
    """Calcola value_orig ('+' / '-' / None) e il flag di conflitto per un parametro di una lingua."""
    # Le question disattivate non contano, ma le loro Answer restano in DB
    # e tornano a contare se la question viene riattivata
    questions = db.query(models.Question).filter(
        models.Question.parameter_id == param_id,
        models.Question.is_active == True,
    ).all()

    norm_qs = [q for q in questions if not q.is_stop_question]
    stop_qs = [q for q in questions if q.is_stop_question]

    # Senza domande normali il parametro resta indeterminato
    if not norm_qs:
        return None, False

    answers = db.query(models.Answer).join(models.Question).filter(
        models.Answer.language_id == lang_id,
        models.Question.parameter_id == param_id,
        models.Question.is_active == True,
        models.Answer.status.in_(ALLOWED_STATUSES)
    ).all()

    ans_dict = {a.question_id: a for a in answers}

    norm_answers = [ans_dict[q.id] for q in norm_qs if q.id in ans_dict]
    stop_answers = [ans_dict[q.id] for q in stop_qs if q.id in ans_dict]

    has_norm_yes = any(is_yes(a) for a in norm_answers)
    has_stop_yes = any(is_yes(a) for a in stop_answers)

    # Almeno un YES su domanda normale: '+', in conflitto se anche una stop-question è YES
    if has_norm_yes:
        warning = has_stop_yes
        return "+", warning

    # Nessun YES normale ma almeno un YES su stop-question: '-'
    if has_stop_yes:
        return "-", False

    norm_q_ids = {q.id for q in norm_qs}
    answered_normals = {a.question_id for a in norm_answers}

    # Copertura incompleta delle domande normali: indeterminato
    if answered_normals != norm_q_ids:
        return None, False

    # Tutte risposte: '-' solo se sono tutte NO
    if all(is_no(a) for a in norm_answers):
        return "-", False

    return None, False


def recompute_and_persist_language_parameter(language_id: str, parameter_id: str, db: Session) -> Optional[models.LanguageParameter]:
    """Ricalcola e salva value_orig/warning_orig della coppia (lingua, parametro)."""
    try:
        # Lock di riga esclusivo per serializzare i ricalcoli concorrenti
        lang = db.query(models.Language).with_for_update().filter(models.Language.id == language_id).one()
    except NoResultFound:
        return None

    # .one() solleva di proposito se il parametro non esiste: è un errore di programmazione
    param = db.query(models.ParameterDef).filter(models.ParameterDef.id == parameter_id).one()

    lp = _get_or_create_lp(language_id, parameter_id, db)
    value, warning = consolidate_parameter_for_language(language_id, parameter_id, db)

    lp.value_orig = value
    lp.warning_orig = bool(warning)

    db.flush()
    return lp
