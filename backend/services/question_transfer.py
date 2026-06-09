"""
Servizio trasferimento dati di una question verso un'altra.

Usato quando si "elimina" (svuota) una question spostando i suoi dati
linguistici (Answer/Example/AnswerMotivation, per ogni lingua) su una question
di destinazione a scelta, invece di archiviarli e basta.

A differenza di question_copy (che *duplica* lasciando intatta la sorgente),
qui i dati vengono *spostati*: la sorgente resta senza dati. Lo spostamento
avviene ri-puntando `Answer.question_id` alla destinazione, così esempi e
motivazioni la seguono via FK senza essere ricreati.

Nodo dei conflitti: `(language_id, question_id)` e' unico, quindi se la
destinazione ha gia' una risposta per una lingua si deve decidere se tenerla
(scartando quella della sorgente) o sovrascriverla con quella della sorgente.
La scelta e' per-lingua (vedi `overwrite_language_ids`).

Nessuna funzione qui committa: la transazione la gestisce il chiamante (router).
"""
from __future__ import annotations
from typing import Set

from sqlalchemy.orm import Session, selectinload

import models


def _summarize_answer(a: models.Answer) -> dict:
    """Riassunto leggero di una risposta per la preview dei conflitti."""
    resp = a.response_text.upper() if a.response_text in ("yes", "no", "unsure") else ""
    return {
        "response_text": resp,
        "examples_count": len(a.examples),
        "motivations_count": len(a.answer_motivations),
        "comments": (a.comments or "").strip(),
    }


def preview_transfer_conflicts(db: Session, source_id: str, dest_id: str) -> dict:
    """Calcola quante lingue verrebbero spostate direttamente e quali sono in
    conflitto (destinazione gia' valorizzata), con un riassunto delle due
    risposte per ogni conflitto."""
    src = (
        db.query(models.Answer)
        .options(
            selectinload(models.Answer.examples),
            selectinload(models.Answer.answer_motivations),
        )
        .filter(models.Answer.question_id == source_id)
        .all()
    )
    dst = (
        db.query(models.Answer)
        .options(
            selectinload(models.Answer.examples),
            selectinload(models.Answer.answer_motivations),
        )
        .filter(models.Answer.question_id == dest_id)
        .all()
    )
    dst_by_lang = {a.language_id: a for a in dst}
    lang_name = {
        l.id: l.name_full
        for l in db.query(models.Language.id, models.Language.name_full).all()
    }

    conflicts = []
    transferable = 0
    for a in src:
        dest_a = dst_by_lang.get(a.language_id)
        if dest_a is None:
            transferable += 1
        else:
            conflicts.append({
                "language_id": a.language_id,
                "language_name": lang_name.get(a.language_id, "") or "",
                "source": _summarize_answer(a),
                "dest": _summarize_answer(dest_a),
            })
    conflicts.sort(key=lambda c: (c["language_name"] or c["language_id"]))

    return {
        "source_total": len(src),
        "dest_total": len(dst),
        "transferable_count": transferable,
        "conflict_count": len(conflicts),
        "conflicts": conflicts,
    }


def transfer_question_data(
    db: Session,
    source_id: str,
    dest_id: str,
    overwrite_language_ids: Set[str],
) -> dict:
    """Sposta le risposte della sorgente sulla destinazione.

    Per ogni lingua:
      - destinazione vuota                       -> sposta (ri-punta question_id)
      - destinazione piena e lingua in overwrite -> cancella la dest, poi sposta
      - destinazione piena e lingua NON overwrite -> cancella la risposta sorgente
        (il dato e' gia' presente in destinazione e nello snapshot d'archivio)

    Ritorna i conteggi {moved, overwritten, kept}. NON committa.
    """
    source_answers = (
        db.query(models.Answer)
        .filter(models.Answer.question_id == source_id)
        .all()
    )
    dest_by_lang = {
        a.language_id: a
        for a in db.query(models.Answer).filter(models.Answer.question_id == dest_id).all()
    }

    moved = overwritten = kept = 0
    for a in source_answers:
        dest_a = dest_by_lang.get(a.language_id)
        if dest_a is None:
            a.question_id = dest_id
            db.flush()
            moved += 1
        elif a.language_id in overwrite_language_ids:
            # Libera lo slot (language_id, dest_id) prima di ri-puntare, altrimenti
            # il vincolo UNIQUE scatterebbe durante il flush.
            db.delete(dest_a)
            db.flush()
            a.question_id = dest_id
            db.flush()
            overwritten += 1
        else:
            db.delete(a)
            kept += 1

    db.flush()
    return {"moved": moved, "overwritten": overwritten, "kept": kept}
