"""
Colore/stato di un parametro per una lingua (wizard Language Data, Fase 1).

Il colore è SEMPRE calcolato dai dati correnti (niente colonna-colore salvata),
tranne il flag `needs_review` su LanguageParameterStatus, che rappresenta un
evento esterno (modifica seria a una question) da "ricordare" finché la lingua
non ri-salva quel parametro.

Regole, valutate in quest'ordine (così la precedenza ROSSO > GIALLO > VERDE è
automatica):
  - GREY   : nessuna risposta a nessuna domanda attiva del parametro
  - RED    : il parametro non è totalmente vuoto, ma almeno una domanda attiva
             è senza risposta (vuota) oppure UNSURE
  - YELLOW : nessuna domanda vuota/unsure, ma c'è un problema "morbido":
               * una risposta MISSING (dato non disponibile, ma acknowledged), o
               * un YES con meno di 2 esempi non vuoti, oppure
               * almeno un esempio marcato is_test, oppure
               * needs_review attivo
  - GREEN  : tutte yes/no, esempi a posto, nessun esempio di test, no needs_review

`is_unsure` (flag di parametro) NON entra nel calcolo: è scollegato dal colore.
"""
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
    """Calcola il colore di un parametro per una lingua. Funzione pura.

    Args:
        question_ids: id delle domande ATTIVE del parametro.
        response_by_qid: {qid: 'yes'|'no'|'unsure'|'missing'|None}.
        example_count_by_qid: {qid: numero di esempi non vuoti della risposta}.
        has_test_example: True se almeno un esempio del parametro (per questa
            lingua) è marcato is_test.
        needs_review: flag "da ricontrollare" per (lingua, parametro).
    """
    if not question_ids:
        return GREY

    responses = [response_by_qid.get(qid) for qid in question_ids]
    if all(r is None for r in responses):
        return GREY
    # ROSSO: una domanda senza risposta (vuota) o con UNSURE → manca una
    # risoluzione vera. MISSING invece è acknowledged → giallo (sotto).
    if any(r is None or r == "unsure" for r in responses):
        return RED

    # Qui ogni domanda ha yes/no/missing (nessuna vuota, nessuna unsure).
    has_missing = any(r == "missing" for r in responses)
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
    """Calcola il colore per molte coppie (lingua, parametro) con poche query.

    Args:
        lang_ids: lingue da valutare.
        param_questions: {param_id: [question_id ATTIVE, ...]}.

    Returns:
        {(language_id, parameter_id): color}.
    """
    lang_ids = list(lang_ids)
    param_ids = list(param_questions.keys())
    all_qids = [qid for qids in param_questions.values() for qid in qids]

    resp_by: Dict[Tuple[str, str], str | None] = {}
    answer_id_by: Dict[Tuple[str, str], int] = {}
    if lang_ids and all_qids:
        for aid, lid, qid, resp in db.query(
            models.Answer.id,
            models.Answer.language_id,
            models.Answer.question_id,
            models.Answer.response_text,
        ).filter(
            models.Answer.language_id.in_(lang_ids),
            models.Answer.question_id.in_(all_qids),
        ).all():
            resp_by[(lid, qid)] = resp
            answer_id_by[(lid, qid)] = aid

    # Esempi: conteggio non vuoti + presenza di is_test, per answer_id.
    ex_count: Dict[int, int] = {}
    ex_test: set[int] = set()
    answer_ids = list(answer_id_by.values())
    if answer_ids:
        for aid, textarea, is_test in db.query(
            models.Example.answer_id,
            models.Example.textarea,
            models.Example.is_test,
        ).filter(models.Example.answer_id.in_(answer_ids)).all():
            if (textarea or "").strip():
                ex_count[aid] = ex_count.get(aid, 0) + 1
            if is_test:
                ex_test.add(aid)

    # needs_review per (lingua, parametro).
    needs: Dict[Tuple[str, str], bool] = {}
    if lang_ids and param_ids:
        for lid, pid, need in db.query(
            models.LanguageParameterStatus.language_id,
            models.LanguageParameterStatus.parameter_id,
            models.LanguageParameterStatus.needs_review,
        ).filter(
            models.LanguageParameterStatus.language_id.in_(lang_ids),
            models.LanguageParameterStatus.parameter_id.in_(param_ids),
        ).all():
            needs[(lid, pid)] = bool(need)

    result: Dict[Tuple[str, str], str] = {}
    for lid in lang_ids:
        for pid in param_ids:
            qids = param_questions.get(pid, [])
            response_by_qid = {qid: resp_by.get((lid, qid)) for qid in qids}
            example_count_by_qid: Dict[str, int] = {}
            has_test = False
            for qid in qids:
                aid = answer_id_by.get((lid, qid))
                if aid is not None:
                    example_count_by_qid[qid] = ex_count.get(aid, 0)
                    if aid in ex_test:
                        has_test = True
            result[(lid, pid)] = param_color(
                qids, response_by_qid, example_count_by_qid, has_test,
                needs.get((lid, pid), False),
            )
    return result


def active_param_questions(db: Session) -> Dict[str, List[str]]:
    """{param_id: [question_id ATTIVE]} per i parametri ATTIVI.

    Helper per i chiamanti (lista lingue, dashboard) che devono calcolare colori
    o completamento di molte lingue: evita di duplicare la query. I parametri
    senza domande attive non compaiono (non sono "rispondibili").
    """
    rows = (
        db.query(models.Question.parameter_id, models.Question.id)
        .join(models.ParameterDef, models.ParameterDef.id == models.Question.parameter_id)
        .filter(models.ParameterDef.is_active == True, models.Question.is_active == True)
        .all()
    )
    pq: Dict[str, List[str]] = {}
    for pid, qid in rows:
        pq.setdefault(pid, []).append(qid)
    return pq


def language_completion_from_colors(colors: List[str]) -> str:
    """Riduce i colori dei parametri di UNA lingua al suo completamento.

    `colors`: colori (grey/red/yellow/green) dei parametri rispondibili (con
    almeno una question attiva).
      - EMPTY      : nessun parametro, oppure tutti grigi (nessuna risposta)
      - COMPLETE   : tutti verdi (regola stretta)
      - INCOMPLETE : qualsiasi altra combinazione
    """
    if not colors or all(c == GREY for c in colors):
        return EMPTY
    if all(c == GREEN for c in colors):
        return COMPLETE
    return INCOMPLETE


def compute_language_completion(
    db: Session,
    lang_ids: Iterable[str],
    param_questions: Dict[str, List[str]],
    override_by_lang: Dict[str, str | None] | None = None,
) -> Dict[str, str]:
    """Completamento (empty/incomplete/complete) per ogni lingua, in batch.

    Rispetta l'override per-lingua (asse A): se `override_by_lang[lid]` è
    valorizzato, vince sul calcolo automatico. Considera solo i parametri con
    almeno una question attiva.
    """
    lang_ids = list(lang_ids)
    override_by_lang = override_by_lang or {}
    answerable = {pid: qids for pid, qids in param_questions.items() if qids}
    colors = compute_colors(db, lang_ids, answerable)
    result: Dict[str, str] = {}
    for lid in lang_ids:
        ov = override_by_lang.get(lid)
        if ov:
            result[lid] = ov
            continue
        lang_colors = [colors[(lid, pid)] for pid in answerable.keys()]
        result[lid] = language_completion_from_colors(lang_colors)
    return result


def flag_parameter_needs_review(db: Session, param_id: str) -> None:
    """Accende `needs_review` per il parametro dato, su tutte le lingue che hanno
    già almeno una risposta a una sua question (crea la riga di stato se manca).

    Da chiamare dopo una modifica SERIA a una question (non "Test edit").
    Non fa commit: lo fa il chiamante.
    """
    qids = [q[0] for q in db.query(models.Question.id).filter(
        models.Question.parameter_id == param_id
    ).all()]
    if not qids:
        return

    lang_ids = [r[0] for r in db.query(models.Answer.language_id).filter(
        models.Answer.question_id.in_(qids)
    ).distinct().all()]
    if not lang_ids:
        return

    existing = {
        s.language_id: s
        for s in db.query(models.LanguageParameterStatus).filter(
            models.LanguageParameterStatus.parameter_id == param_id,
            models.LanguageParameterStatus.language_id.in_(lang_ids),
        ).all()
    }
    for lid in lang_ids:
        s = existing.get(lid)
        if s is None:
            db.add(models.LanguageParameterStatus(
                language_id=lid, parameter_id=param_id, needs_review=True,
            ))
        else:
            s.needs_review = True
