"""Ritrova un parametro anche dopo un rename (via alias)."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from sqlalchemy.orm import Session

import models


@dataclass
class ParameterResolveResult:
    parameter: Optional[models.ParameterDef]
    matched_via_alias: bool = False


def resolve_parameter(db: Session, file_id: str) -> ParameterResolveResult:
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
        # alias orfano: parametro cancellato
        return ParameterResolveResult(parameter=None)

    return ParameterResolveResult(parameter=p, matched_via_alias=True)
