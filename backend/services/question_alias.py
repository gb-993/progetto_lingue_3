"""Ritrova una domanda anche dopo un rename (via alias)."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from sqlalchemy.orm import Session

import models


@dataclass
class QuestionResolveResult:
    question: Optional[models.Question]
    matched_via_alias: bool = False


def resolve_question(db: Session, file_id: str) -> QuestionResolveResult:
    if not file_id:
        return QuestionResolveResult(question=None)

    q = db.query(models.Question).filter(models.Question.id == file_id).first()
    if q is not None:
        return QuestionResolveResult(question=q, matched_via_alias=False)

    alias = (
        db.query(models.QuestionAlias)
        .filter(models.QuestionAlias.old_id == file_id)
        .first()
    )
    if alias is None:
        return QuestionResolveResult(question=None)

    q = db.get(models.Question, alias.question_id)
    if q is None:
        # alias orfano: domanda cancellata
        return QuestionResolveResult(question=None)

    return QuestionResolveResult(question=q, matched_via_alias=True)
