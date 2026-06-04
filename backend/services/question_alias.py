"""Resolver Question by id corrente + fallback su alias storici.

Usato da restore di backup ed Excel import per riconoscere una domanda anche
quando il suo id corrente non corrisponde a quello salvato nel file (la
domanda e' stata rinominata via UI admin dopo l'export).

Speculare a `services.language_alias`, ma piu' semplice: la Question non ha
un codice esterno (tipo glottocode) da usare per disambiguare, quindi il
match via alias e' diretto.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from sqlalchemy.orm import Session

import models


@dataclass
class QuestionResolveResult:
    """Esito del lookup di una domanda per id (eventualmente via alias).

    - `question`: l'istanza Question trovata, oppure None.
    - `matched_via_alias`: True se il match e' avvenuto sulla tabella alias
      (l'id del file differisce dall'id corrente). False se match diretto.
    """
    question: Optional[models.Question]
    matched_via_alias: bool = False


def resolve_question(db: Session, file_id: str) -> QuestionResolveResult:
    """Cerca una domanda per id corrente, con fallback su `question_aliases`."""
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
        # alias orfano (la domanda e' stata cancellata): trattalo come miss.
        return QuestionResolveResult(question=None)

    return QuestionResolveResult(question=q, matched_via_alias=True)
