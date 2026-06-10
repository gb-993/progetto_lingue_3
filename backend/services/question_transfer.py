"""
Servizio "copia esempi" tra question (richiesta linguisti, 2026-06: "copiare
solo gli esempi di PSC_Qb in PSC_Qa, senza la domanda o la risposta o le
motivazioni").

Gli esempi della sorgente vengono DUPLICATI in coda a quelli della
destinazione, lingua per lingua. Risposte, motivazioni e testi non vengono
toccati, e la sorgente resta intatta (potra' poi essere disattivata
normalmente).

Vincolo strutturale: un Example vive agganciato a una Answer. Le lingue per
cui la destinazione NON ha una risposta vengono saltate e segnalate nel
report: creare una risposta "vuota" solo per attaccarci esempi inquinerebbe
la compilazione.

NB storico: qui viveva anche il "Move data" (spostamento delle risposte
intere con risoluzione conflitti keep/overwrite). Rimosso a giugno 2026 su
richiesta: l'unico caso d'uso reale era consolidare gli esempi, e la copia
lo copre senza perdita di dati.

Nessuna funzione qui committa: la transazione la gestisce il chiamante (router).
"""
from __future__ import annotations

from sqlalchemy.orm import Session, selectinload

import models

def _example_fingerprint(e: models.Example) -> tuple:
    """Identita' di contenuto di un esempio, per la dedup in copia.

    Confronta i campi testuali (trim): rilanciare la copia due volte non deve
    duplicare esempi gia' presenti in destinazione. `number` e' escluso
    apposta: e' solo un'etichetta d'ordine.
    """
    return (
        (e.textarea or "").strip(),
        (e.transliteration or "").strip(),
        (e.gloss or "").strip(),
        (e.translation or "").strip(),
        (e.reference or "").strip(),
    )


def _next_example_number(dest_examples: list) -> int:
    """Primo numero libero per gli esempi copiati: max dei `number` numerici
    esistenti (fallback: quanti esempi ci sono) + 1."""
    best = len(dest_examples)
    for e in dest_examples:
        try:
            best = max(best, int((e.number or "").strip()))
        except ValueError:
            pass
    return best + 1


def _load_answers_with_examples(db: Session, question_id: str) -> list:
    return (
        db.query(models.Answer)
        .options(selectinload(models.Answer.examples))
        .filter(models.Answer.question_id == question_id)
        .all()
    )


def preview_examples_copy(db: Session, source_id: str, dest_id: str) -> dict:
    """Anteprima della copia esempi: per ogni lingua dice quanti esempi
    verrebbero copiati, quanti sono gia' presenti identici (duplicati,
    saltati) e quali lingue verrebbero saltate perche' la destinazione non
    ha una risposta a cui agganciarli."""
    src_answers = _load_answers_with_examples(db, source_id)
    dst_by_lang = {a.language_id: a for a in _load_answers_with_examples(db, dest_id)}
    lang_name = {
        l.id: l.name_full
        for l in db.query(models.Language.id, models.Language.name_full).all()
    }

    copyable, skipped = [], []
    for a in src_answers:
        if not a.examples:
            continue
        entry = {
            "language_id": a.language_id,
            "language_name": lang_name.get(a.language_id, "") or "",
            "examples_count": len(a.examples),
        }
        dest_a = dst_by_lang.get(a.language_id)
        if dest_a is None:
            skipped.append(entry)
        else:
            dest_fps = {_example_fingerprint(e) for e in dest_a.examples}
            dup = sum(1 for e in a.examples if _example_fingerprint(e) in dest_fps)
            entry["duplicates_count"] = dup
            copyable.append(entry)

    copyable.sort(key=lambda c: (c["language_name"] or c["language_id"]))
    skipped.sort(key=lambda c: (c["language_name"] or c["language_id"]))
    return {
        "copyable": copyable,
        "skipped": skipped,
        "copyable_examples_total": sum(c["examples_count"] - c["duplicates_count"] for c in copyable),
        "duplicates_total": sum(c["duplicates_count"] for c in copyable),
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
    src_answers = _load_answers_with_examples(db, source_id)
    dst_by_lang = {a.language_id: a for a in _load_answers_with_examples(db, dest_id)}

    languages_processed = 0
    examples_copied = 0
    duplicates_skipped = 0
    languages_skipped: list[str] = []

    for a in src_answers:
        if not a.examples:
            continue
        dest_a = dst_by_lang.get(a.language_id)
        if dest_a is None:
            languages_skipped.append(a.language_id)
            continue

        dest_fps = {_example_fingerprint(e) for e in dest_a.examples}
        next_n = _next_example_number(dest_a.examples)
        copied_here = 0
        for e in a.examples:
            fp = _example_fingerprint(e)
            if fp in dest_fps:
                duplicates_skipped += 1
                continue
            db.add(models.Example(
                answer_id=dest_a.id,
                number=str(next_n),
                textarea=e.textarea,
                transliteration=e.transliteration,
                gloss=e.gloss,
                translation=e.translation,
                reference=e.reference,
            ))
            dest_fps.add(fp)
            next_n += 1
            copied_here += 1
        if copied_here > 0:
            languages_processed += 1
        examples_copied += copied_here

    db.flush()
    languages_skipped.sort()
    return {
        "languages_processed": languages_processed,
        "examples_copied": examples_copied,
        "duplicates_skipped": duplicates_skipped,
        "languages_skipped": languages_skipped,
    }
