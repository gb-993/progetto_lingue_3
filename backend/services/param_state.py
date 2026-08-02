from __future__ import annotations

from typing import Dict, Iterable, List, Tuple

from sqlalchemy.orm import Session

import models


GREY = "grey"
RED = "red"
YELLOW = "yellow"
GREEN = "green"

# Completamento a livello di LINGUA (asse A). Riassume i colori dei quadratini.
EMPTY = "empty"
INCOMPLETE = "incomplete"
COMPLETE = "complete"

def param_color(
    question_ids: List[str],
    response_by_qid: Dict[str, str | None],
    example_count_by_qid: Dict[str, int],
    has_test_example: bool,
    needs_review: bool,
) -> str:
    """Calcola il colore di un parametro per una lingua (funzione pura); `response_by_qid` usa i valori 'yes'/'no'/'unsure'/'missing'/None."""
    if not question_ids:
        return GREY

    responses = [response_by_qid.get(qid) for qid in question_ids]
    if all(response is None for response in responses):
        return GREY
    # Domanda senza risposta o UNSURE: manca una risoluzione vera → RED.
    # MISSING invece non blocca (vedi YELLOW sotto).
    if any(response is None or response == "unsure" for response in responses):
        return RED

    # Qui ogni domanda ha yes/no/missing (nessuna vuota, nessuna unsure).
    has_missing = any(response == "missing" for response in responses)
    examples_missing = any(
        response_by_qid.get(qid) == "yes" and example_count_by_qid.get(qid, 0) < 2
        for qid in question_ids
    )
    if needs_review or has_missing or examples_missing or has_test_example:
        return YELLOW
    return GREEN


def compute_colors(
    db: Session,
    lang_ids: Iterable[str],
    param_questions: Dict[str, List[str]],
) -> Dict[Tuple[str, str], str]:
    """Calcola il colore per molte coppie (lingua, parametro) con poche query; ritorna {(language_id, parameter_id): color}."""
    lang_ids = list(lang_ids)
    param_ids = list(param_questions.keys())
    all_qids = [qid for qids in param_questions.values() for qid in qids]

    response_by_lang_and_question: Dict[Tuple[str, str], str | None] = {}
    answer_id_by_lang_and_question: Dict[Tuple[str, str], int] = {}
    if lang_ids and all_qids:
        for answer_id, language_id, question_id, response_text in db.query(
            models.Answer.id,
            models.Answer.language_id,
            models.Answer.question_id,
            models.Answer.response_text,
        ).filter(
            models.Answer.language_id.in_(lang_ids),
            models.Answer.question_id.in_(all_qids),
        ).all():
            response_by_lang_and_question[(language_id, question_id)] = response_text
            answer_id_by_lang_and_question[(language_id, question_id)] = answer_id

    # Esempi: conteggio non vuoti + presenza di is_test, per answer_id.
    example_count_by_answer_id: Dict[int, int] = {}
    answer_ids_with_test_example: set[int] = set()
    answer_ids = list(answer_id_by_lang_and_question.values())
    if answer_ids:
        for answer_id, textarea, is_test in db.query(
            models.Example.answer_id,
            models.Example.textarea,
            models.Example.is_test,
        ).filter(models.Example.answer_id.in_(answer_ids)).all():
            if (textarea or "").strip():
                example_count_by_answer_id[answer_id] = example_count_by_answer_id.get(answer_id, 0) + 1
            if is_test:
                answer_ids_with_test_example.add(answer_id)

    needs_review_by_lang_and_param: Dict[Tuple[str, str], bool] = {}
    if lang_ids and param_ids:
        for language_id, parameter_id, needs_review_flag in db.query(
            models.LanguageParameterStatus.language_id,
            models.LanguageParameterStatus.parameter_id,
            models.LanguageParameterStatus.needs_review,
        ).filter(
            models.LanguageParameterStatus.language_id.in_(lang_ids),
            models.LanguageParameterStatus.parameter_id.in_(param_ids),
        ).all():
            needs_review_by_lang_and_param[(language_id, parameter_id)] = bool(needs_review_flag)

    result: Dict[Tuple[str, str], str] = {}
    for language_id in lang_ids:
        for parameter_id in param_ids:
            question_ids = param_questions.get(parameter_id, [])
            response_by_qid = {qid: response_by_lang_and_question.get((language_id, qid)) for qid in question_ids}
            example_count_by_qid: Dict[str, int] = {}
            has_test = False
            for qid in question_ids:
                answer_id = answer_id_by_lang_and_question.get((language_id, qid))
                if answer_id is not None:
                    example_count_by_qid[qid] = example_count_by_answer_id.get(answer_id, 0)
                    if answer_id in answer_ids_with_test_example:
                        has_test = True
            result[(language_id, parameter_id)] = param_color(
                question_ids, response_by_qid, example_count_by_qid, has_test,
                needs_review_by_lang_and_param.get((language_id, parameter_id), False),
            )
    return result


def active_param_questions(db: Session) -> Dict[str, List[str]]:
    """{param_id: [question_id ATTIVE]} per i parametri attivi; evita ai chiamanti (lista lingue, dashboard) di duplicare la query. I parametri senza domande attive non compaiono."""
    rows = (
        db.query(models.Question.parameter_id, models.Question.id)
        .join(models.ParameterDef, models.ParameterDef.id == models.Question.parameter_id)
        .filter(models.ParameterDef.is_active == True, models.Question.is_active == True)
        .all()
    )
    question_ids_by_param: Dict[str, List[str]] = {}
    for parameter_id, question_id in rows:
        question_ids_by_param.setdefault(parameter_id, []).append(question_id)
    return question_ids_by_param


def language_completion_from_colors(colors: List[str]) -> str:
    """Riduce i colori dei parametri rispondibili di una lingua al completamento: EMPTY se nessuno o tutti grigi, COMPLETE se tutti verdi, INCOMPLETE altrimenti."""
    if not colors or all(color == GREY for color in colors):
        return EMPTY
    if all(color == GREEN for color in colors):
        return COMPLETE
    return INCOMPLETE


def compute_language_completion(
    db: Session,
    lang_ids: Iterable[str],
    param_questions: Dict[str, List[str]],
    override_by_lang: Dict[str, str | None] | None = None,
) -> Dict[str, str]:
    """Completamento (empty/incomplete/complete) per ogni lingua in batch; l'override per-lingua in `override_by_lang` vince sul calcolo automatico se valorizzato."""
    lang_ids = list(lang_ids)
    override_by_lang = override_by_lang or {}
    answerable = {pid: qids for pid, qids in param_questions.items() if qids}
    colors = compute_colors(db, lang_ids, answerable)
    result: Dict[str, str] = {}
    for language_id in lang_ids:
        override = override_by_lang.get(language_id)
        if override:
            result[language_id] = override
            continue
        language_colors = [colors[(language_id, pid)] for pid in answerable.keys()]
        result[language_id] = language_completion_from_colors(language_colors)
    return result


def flag_parameter_needs_review(db: Session, param_id: str) -> None:
    """Accende `needs_review` per il parametro su tutte le lingue con già una risposta a una sua question (crea la riga di stato se manca); da chiamare dopo una modifica seria alla question, non committa."""
    question_ids = [row[0] for row in db.query(models.Question.id).filter(
        models.Question.parameter_id == param_id
    ).all()]
    if not question_ids:
        return

    lang_ids = [row[0] for row in db.query(models.Answer.language_id).filter(
        models.Answer.question_id.in_(question_ids)
    ).distinct().all()]
    if not lang_ids:
        return

    existing_status_by_lang = {
        status.language_id: status
        for status in db.query(models.LanguageParameterStatus).filter(
            models.LanguageParameterStatus.parameter_id == param_id,
            models.LanguageParameterStatus.language_id.in_(lang_ids),
        ).all()
    }
    for language_id in lang_ids:
        status = existing_status_by_lang.get(language_id)
        if status is None:
            db.add(models.LanguageParameterStatus(
                language_id=language_id, parameter_id=param_id, needs_review=True,
            ))
        else:
            status.needs_review = True
