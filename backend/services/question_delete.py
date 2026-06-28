"""
Eliminazione DEFINITIVA di una Question.

Differenza dal "soft-delete": `toggle-active` disattiva soltanto (la Question e i
suoi dati restano in DB, dormienti). Qui invece la Question viene rimossa dal DB
vivo. Per non perdere il lavoro dei linguisti, gli eventuali dati collegati
(Answer/Example/AnswerMotivation di tutte le lingue) vengono PRIMA archiviati nelle
tabelle archived_* (consultabili in "Archived Questions" ed esportabili), poi la
Question viene cancellata.

Consentita SOLO su Question gia' disattivate: il guard `QuestionStillActiveError`
e' la rete di protezione a livello servizio (l'endpoint controlla `is_active` e
risponde 409 prima ancora di arrivare qui).

API principale:
  delete_question_permanently(db, question, user_id, change_note="") -> Optional[int]
    Ritorna l'id dell'ArchivedQuestion creata (se c'erano dati), altrimenti None.
    NON committa: la transazione e' gestita dal chiamante.
"""
from __future__ import annotations
from typing import Optional

from sqlalchemy.orm import Session

import models
from services import archive_service
from services.versioning import record_version


class QuestionStillActiveError(Exception):
    """La Question e' ancora attiva: va disattivata prima dell'eliminazione."""


def delete_question_permanently(
    db: Session,
    question: models.Question,
    user_id: Optional[int],
    *,
    change_note: str = "",
) -> Optional[int]:
    if question.is_active:
        raise QuestionStillActiveError(question.id)

    parameter_id = question.parameter_id

    # 1. Archivia i dati collegati, se ce ne sono. archive_and_wipe fa lo
    #    snapshot nelle tabelle archived_* e cancella le Answer vive (Example e
    #    AnswerMotivation seguono per cascata ORM). Se la Question non ha dati,
    #    saltiamo l'archivio: la sua definizione resta comunque nello snapshot
    #    'delete' di History qui sotto.
    stats = archive_service.count_linked_data(db, question.id)
    archived_id: Optional[int] = None
    if stats["answers"] > 0:
        archived = archive_service.archive_and_wipe(
            db=db,
            question=question,
            user_id=user_id,
            archive_note=(change_note or "").strip(),
        )
        archived_id = archived.id

    # 2. Snapshot 'delete' in History PRIMA di rimuovere la riga: la timeline
    #    della Question conserva chi/quando/cosa e' stato eliminato (incluse le
    #    allowed_motivation_codes, ancora presenti in questo momento).
    record_version(
        db, question, operation="delete", source="manual",
        user_id=user_id, note=(change_note or None),
    )

    # 3. Log sul parametro genitore (il question_id resta solo nel testo).
    note = (change_note or "").strip()
    suffix = f" Note: {note}" if note else ""
    archived_part = (
        f" ({stats['answers']} answer(s), {stats['examples']} example(s) in "
        f"{stats['languages']} language(s) archived)"
        if archived_id else ""
    )
    db.add(models.ParameterChangeLog(
        parameter_id=parameter_id,
        user_id=user_id,
        change_note=f"[Question {question.id}] Permanently deleted{archived_part}.{suffix}",
    ))

    # 4. Rimuove la Question. question_aliases e question_allowed_motivations
    #    spariscono per cascata (ondelete=CASCADE in DB + cascade ORM
    #    delete-orphan). Le Answer sono gia' state archiviate/cancellate al
    #    punto 1, quindi non c'e' nessuna FK residua a bloccare la delete.
    db.delete(question)
    db.flush()

    return archived_id
