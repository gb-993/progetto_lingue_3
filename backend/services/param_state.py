from __future__ import annotations

from typing import Dict, Iterable, List, Tuple

from sqlalchemy import case, func
from sqlalchemy.orm import Session

import models


GREY = "grey"
RED = "red"
YELLOW = "yellow"
GREEN = "green"

# completamento della lingua (riassume i colori)
EMPTY = "empty"
INCOMPLETE = "incomplete"
COMPLETE = "complete"

# gli stessi spazi che toglie str.strip(): un esempio "vuoto" per il DB lo è anche per Python
_WHITESPACE = "".join(chr(c) for c in range(0x3001) if chr(c).isspace())

def param_color(
    question_ids: List[str],
    response_by_qid: Dict[str, str | None],
    example_count_by_qid: Dict[str, int],
    has_test_example: bool,
    needs_review: bool,
) -> str:
    """Colore di un parametro per una lingua."""
    if not question_ids:
        return GREY

    responses = [response_by_qid.get(qid) for qid in question_ids]
    if all(response is None for response in responses):
        return GREY
    # risposta vuota o unsure: rosso
    if any(response is None or response == "unsure" for response in responses):
        return RED

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
    """Colori per molte coppie (lingua, parametro), con poche query."""
    lang_ids = list(lang_ids)
    param_ids = list(param_questions.keys())
    all_qids = [qid for qids in param_questions.values() for qid in qids]

    response_by_lang_and_question: Dict[Tuple[str, str], str | None] = {}
    example_count_by_lang_and_question: Dict[Tuple[str, str], int] = {}
    lang_and_questions_with_test: set[Tuple[str, str]] = set()
    if lang_ids and all_qids:
        # gli esempi li conta il DB: niente testi scaricati né IN con migliaia di id
        example_has_text = func.trim(func.coalesce(models.Example.textarea, ""), _WHITESPACE) != ""
        rows = (
            db.query(
                models.Answer.language_id,
                models.Answer.question_id,
                models.Answer.response_text,
                func.count(case((example_has_text, 1))),
                func.max(case((models.Example.is_test == True, 1), else_=0)),  # noqa: E712
            )
            .outerjoin(models.Example, models.Example.answer_id == models.Answer.id)
            .filter(
                models.Answer.language_id.in_(lang_ids),
                models.Answer.question_id.in_(all_qids),
            )
            .group_by(
                models.Answer.id,
                models.Answer.language_id,
                models.Answer.question_id,
                models.Answer.response_text,
            )
        )
        for language_id, question_id, response_text, example_count, has_test in rows:
            key = (language_id, question_id)
            response_by_lang_and_question[key] = response_text
            example_count_by_lang_and_question[key] = example_count
            if has_test:
                lang_and_questions_with_test.add(key)

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
            example_count_by_qid = {
                qid: example_count_by_lang_and_question[(language_id, qid)]
                for qid in question_ids
                if (language_id, qid) in example_count_by_lang_and_question
            }
            has_test = any((language_id, qid) in lang_and_questions_with_test for qid in question_ids)
            result[(language_id, parameter_id)] = param_color(
                question_ids, response_by_qid, example_count_by_qid, has_test,
                needs_review_by_lang_and_param.get((language_id, parameter_id), False),
            )
    return result


def active_param_questions(db: Session) -> Dict[str, List[str]]:
    """Domande attive per ogni parametro attivo."""
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
    """Dai colori al completamento della lingua."""
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
    """Completamento di ogni lingua; l'override, se c'è, vince."""
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
    """Segna needs_review sulle lingue che hanno già risposto. Non committa."""
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
