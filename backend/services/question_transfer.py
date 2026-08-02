"""
Servizio "copia esempi" tra question 
"""
from __future__ import annotations

from sqlalchemy.orm import Session, selectinload

import models

def _example_fingerprint(example: models.Example) -> tuple:
    return (
        (example.textarea or "").strip(),
        (example.transliteration or "").strip(),
        (example.gloss or "").strip(),
        (example.translation or "").strip(),
        (example.reference or "").strip(),
    )


def _next_example_number(dest_examples: list) -> int:
    highest_number = len(dest_examples)
    for example in dest_examples:
        try:
            highest_number = max(highest_number, int((example.number or "").strip()))
        except ValueError:
            pass
    return highest_number + 1


def _load_answers_with_examples(db: Session, question_id: str) -> list:
    return (
        db.query(models.Answer)
        .options(selectinload(models.Answer.examples))
        .filter(models.Answer.question_id == question_id)
        .all()
    )


def preview_examples_copy(db: Session, source_id: str, dest_id: str) -> dict:

    source_answers = _load_answers_with_examples(db, source_id)
    dest_answer_by_lang = {answer.language_id: answer for answer in _load_answers_with_examples(db, dest_id)}
    language_name_by_id = {
        language.id: language.name_full
        for language in db.query(models.Language.id, models.Language.name_full).all()
    }

    copyable, skipped = [], []
    for source_answer in source_answers:
        if not source_answer.examples:
            continue
        entry = {
            "language_id": source_answer.language_id,
            "language_name": language_name_by_id.get(source_answer.language_id, "") or "",
            "examples_count": len(source_answer.examples),
        }
        dest_answer = dest_answer_by_lang.get(source_answer.language_id)
        if dest_answer is None:
            skipped.append(entry)
        else:
            dest_fingerprints = {_example_fingerprint(example) for example in dest_answer.examples}
            duplicates_count = sum(1 for example in source_answer.examples if _example_fingerprint(example) in dest_fingerprints)
            entry["duplicates_count"] = duplicates_count
            copyable.append(entry)

    copyable.sort(key=lambda entry: (entry["language_name"] or entry["language_id"]))
    skipped.sort(key=lambda entry: (entry["language_name"] or entry["language_id"]))
    return {
        "copyable": copyable,
        "skipped": skipped,
        "copyable_examples_total": sum(entry["examples_count"] - entry["duplicates_count"] for entry in copyable),
        "duplicates_total": sum(entry["duplicates_count"] for entry in copyable),
    }


def copy_examples_only(db: Session, source_id: str, dest_id: str) -> dict:
    """Copia gli esempi della sorgente sulle risposte della destinazione.

    Per ogni lingua in cui la sorgente ha esempi:
      - destinazione con risposta -> duplica gli esempi in coda (numerazione
        che prosegue quella esistente); gli esempi identici gia' presenti
        vengono saltati (idempotente);
      - destinazione senza risposta -> lingua saltata (vedi report).

    Nessuna marcatura sugli esempi copiati (richiesta esplicita dei
    linguisti): la tracciabilita' sta nel ParameterChangeLog del chiamante.
    Ritorna i conteggi. NON committa.
    """
    source_answers = _load_answers_with_examples(db, source_id)
    dest_answer_by_lang = {answer.language_id: answer for answer in _load_answers_with_examples(db, dest_id)}

    languages_processed = 0
    examples_copied = 0
    duplicates_skipped = 0
    languages_skipped: list[str] = []

    for source_answer in source_answers:
        if not source_answer.examples:
            continue
        dest_answer = dest_answer_by_lang.get(source_answer.language_id)
        if dest_answer is None:
            languages_skipped.append(source_answer.language_id)
            continue

        dest_fingerprints = {_example_fingerprint(example) for example in dest_answer.examples}
        next_number = _next_example_number(dest_answer.examples)
        copied_count = 0
        for example in source_answer.examples:
            fingerprint = _example_fingerprint(example)
            if fingerprint in dest_fingerprints:
                duplicates_skipped += 1
                continue
            db.add(models.Example(
                answer_id=dest_answer.id,
                number=str(next_number),
                textarea=example.textarea,
                transliteration=example.transliteration,
                gloss=example.gloss,
                translation=example.translation,
                reference=example.reference,
                is_test=bool(example.is_test),
            ))
            dest_fingerprints.add(fingerprint)
            next_number += 1
            copied_count += 1
        if copied_count > 0:
            languages_processed += 1
        examples_copied += copied_count

    db.flush()
    languages_skipped.sort()
    return {
        "languages_processed": languages_processed,
        "examples_copied": examples_copied,
        "duplicates_skipped": duplicates_skipped,
        "languages_skipped": languages_skipped,
    }
