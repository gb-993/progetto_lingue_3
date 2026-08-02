"""
Eliminazione DEFINITIVA di una Question.

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

    # Archivia i dati collegati, se ce ne sono. 
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

    #  Snapshot 'delete' in History PRIMA di rimuovere la riga
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

    # 4. Rimuove la Question. question_aliases e question_allowed_motivations spariscono per cascata 
    db.delete(question)
    db.flush()

    return archived_id
