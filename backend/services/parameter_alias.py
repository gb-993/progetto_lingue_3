"""Resolver ParameterDef by id corrente + fallback su alias storici.

Usato da restore di backup ed Excel import per riconoscere un parametro anche
quando il suo id corrente non corrisponde a quello salvato nel file (il
parametro e' stato rinominato via UI admin dopo l'export).

Speculare a `services.question_alias`.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from sqlalchemy.orm import Session

import models


@dataclass
class ParameterResolveResult:
    """Esito del lookup di un parametro per id (eventualmente via alias)."""
    parameter: Optional[models.ParameterDef]
    matched_via_alias: bool = False


def resolve_parameter(db: Session, file_id: str) -> ParameterResolveResult:
    """Cerca un parametro per id corrente, con fallback su `parameter_aliases`."""
    if not file_id:
        return ParameterResolveResult(parameter=None)

    p = db.query(models.ParameterDef).filter(models.ParameterDef.id == file_id).first()
    if p is not None:
        return ParameterResolveResult(parameter=p, matched_via_alias=False)

    alias = (
        db.query(models.ParameterAlias)
        .filter(models.ParameterAlias.old_id == file_id)
        .first()
    )
    if alias is None:
        return ParameterResolveResult(parameter=None)

    p = db.get(models.ParameterDef, alias.parameter_id)
    if p is None:
        # alias orfano (il parametro e' stato cancellato): trattalo come miss.
        return ParameterResolveResult(parameter=None)

    return ParameterResolveResult(parameter=p, matched_via_alias=True)
