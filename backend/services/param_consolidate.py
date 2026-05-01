from __future__ import annotations
from typing import Optional, Tuple

from sqlalchemy.orm import Session
from sqlalchemy.exc import NoResultFound
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
        # Usiamo flush al posto di commit per mantenere l'atomicità
        # della transazione gestita a livello superiore
        db.flush()
    return obj

def is_yes(ans: models.Answer) -> bool:
    # Rimosso il .strip() per ripristinare la non-tolleranza agli spazi
    return ans.response_text is not None and ans.response_text.lower() == "yes"

def is_no(ans: models.Answer) -> bool:
    # Rimosso il .strip() per ripristinare la non-tolleranza agli spazi
    return ans.response_text is not None and ans.response_text.lower() == "no"

def consolidate_parameter_for_language(lang_id: str, param_id: str, db: Session) -> Tuple[Optional[str], bool]:
    """
    Calcola il valore ORIGINALE del parametro (+ / - / None) e il warning (solo conflitto).
    Logica originale rigorosamente ripristinata.
    """
    # Solo domande attive: una question disattivata non deve influenzare value_orig.
    # Le Answer collegate restano in DB e tornano a contare se la question viene riattivata.
    questions = db.query(models.Question).filter(
        models.Question.parameter_id == param_id,
        models.Question.is_active == True,
    ).all()

    norm_qs = [q for q in questions if not q.is_stop_question]
    stop_qs = [q for q in questions if q.is_stop_question]

    # RIPRISTINO CRITICO: Se per anomalia non ci sono domande normali, NON determiniamo
    if not norm_qs:
        return None, False

    # Recupera le risposte valide
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

    # Caso 1: almeno un YES su domanda normale => '+'
    if has_norm_yes:
        warning = has_stop_yes  # conflitto: YES normale + YES stop
        return "+", warning

    # Caso 2: nessun YES normale, ma almeno un YES stop => '-'
    if has_stop_yes:
        return "-", False

    # Caso 3: valuta se TUTTE le normali hanno NO
    norm_q_ids = {q.id for q in norm_qs}
    answered_normals = {a.question_id for a in norm_answers}

    # Se non abbiamo copertura completa, è indeterminato
    if answered_normals != norm_q_ids:
        return None, False

    # Tutte le normali sono risposte: se tutte NO -> '-', altrimenti indeterminato
    if all(is_no(a) for a in norm_answers):
        return "-", False

    # fallback prudenziale
    return None, False


def recompute_and_persist_language_parameter(language_id: str, parameter_id: str, db: Session) -> Optional[models.LanguageParameter]:
    """
    Punto di ingresso: ricalcola e salva value_orig/warning_orig di (language, parameter).
    """
    try:
        # lock di riga esclusivo come il select_for_update() di Django
        lang = db.query(models.Language).with_for_update().filter(models.Language.id == language_id).one()
    except NoResultFound:
        return None

    # Ripristinato il crash intenzionale (solleva NoResultFound invece di restituire None)
    # se il parametro non esiste, esattamente come faceva ParameterDef.objects.get()
    param = db.query(models.ParameterDef).filter(models.ParameterDef.id == parameter_id).one()

    lp = _get_or_create_lp(language_id, parameter_id, db)
    value, warning = consolidate_parameter_for_language(language_id, parameter_id, db)

    lp.value_orig = value
    lp.warning_orig = bool(warning)

    db.flush()
    return lp