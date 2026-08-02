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

def _get_or_create_lp(language_id: str, parameter_id: str, db: Session) -> models.LanguageParameter:
    """Restituisce la riga LanguageParameter di (lingua, parametro), creandola se manca."""
    language_parameter = db.query(models.LanguageParameter).filter(
        models.LanguageParameter.language_id == language_id,
        models.LanguageParameter.parameter_id == parameter_id
    ).first()

    if not language_parameter:
        language_parameter = models.LanguageParameter(
            language_id=language_id,
            parameter_id=parameter_id,
            value_orig=None,
            warning_orig=False
        )
        db.add(language_parameter)
        # flush e non commit: la transazione è gestita dal chiamante
        db.flush()
    return language_parameter

def is_yes(answer: models.Answer) -> bool:
    return answer.response_text is not None and answer.response_text.lower() == "yes"

def is_no(answer: models.Answer) -> bool:
    return answer.response_text is not None and answer.response_text.lower() == "no"

def consolidate_parameter_for_language(language_id: str, parameter_id: str, db: Session) -> Tuple[Optional[str], bool]:
    """Calcola value_orig ('+' / '-' / None) e il flag di conflitto per un parametro di una lingua."""
    # Le question disattivate non contano, ma le loro Answer restano in DB
    # e tornano a contare se la question viene riattivata
    questions = db.query(models.Question).filter(
        models.Question.parameter_id == parameter_id,
        models.Question.is_active == True,
    ).all()

    normal_questions = [q for q in questions if not q.is_stop_question]
    stop_questions = [q for q in questions if q.is_stop_question]

    # Senza domande normali il parametro resta indeterminato
    if not normal_questions:
        return None, False

    answers = db.query(models.Answer).join(models.Question).filter(
        models.Answer.language_id == language_id,
        models.Question.parameter_id == parameter_id,
        models.Question.is_active == True,
        models.Answer.status.in_(ALLOWED_STATUSES)
    ).all()

    answers_by_question_id = {a.question_id: a for a in answers}

    normal_answers = [answers_by_question_id[q.id] for q in normal_questions if q.id in answers_by_question_id]
    stop_answers = [answers_by_question_id[q.id] for q in stop_questions if q.id in answers_by_question_id]

    has_normal_yes = any(is_yes(a) for a in normal_answers)
    has_stop_yes = any(is_yes(a) for a in stop_answers)

    # Almeno un YES su domanda normale: '+', in conflitto se anche una stop-question è YES
    if has_normal_yes:
        warning = has_stop_yes
        return "+", warning

    # Nessun YES normale ma almeno un YES su stop-question: '-'
    if has_stop_yes:
        return "-", False

    normal_question_ids = {q.id for q in normal_questions}
    answered_normal_question_ids = {a.question_id for a in normal_answers}

    # Copertura incompleta delle domande normali: indeterminato
    if answered_normal_question_ids != normal_question_ids:
        return None, False

    # Tutte risposte: '-' solo se sono tutte NO
    if all(is_no(a) for a in normal_answers):
        return "-", False

    return None, False


def recompute_and_persist_language_parameter(language_id: str, parameter_id: str, db: Session) -> Optional[models.LanguageParameter]:
    """Ricalcola e salva value_orig/warning_orig della coppia (lingua, parametro)."""
    try:
        # Lock di riga esclusivo per serializzare i ricalcoli concorrenti
        language = db.query(models.Language).with_for_update().filter(models.Language.id == language_id).one()
    except NoResultFound:
        return None

    parameter = db.query(models.ParameterDef).filter(models.ParameterDef.id == parameter_id).one()

    language_parameter = _get_or_create_lp(language_id, parameter_id, db)
    value, warning = consolidate_parameter_for_language(language_id, parameter_id, db)

    language_parameter.value_orig = value
    language_parameter.warning_orig = bool(warning)

    db.flush()
    return language_parameter
