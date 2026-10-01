"""Storico delle entità: snapshot JSON in `entity_versions`."""
from __future__ import annotations
from typing import Any, Optional
from datetime import datetime, date
from decimal import Decimal

from sqlalchemy import inspect
from sqlalchemy.orm import Session

import models


# classe modello -> entity_type
ENTITY_TYPE_MAP = {
    "ParameterDef": "parameter",
    "Question": "question",
    "Motivation": "motivation",
    "Language": "language",
    "Answer": "answer",
}

MODEL_BY_TYPE = {v: k for k, v in ENTITY_TYPE_MAP.items()}


def _entity_type_for(entity: Any) -> str:
    return ENTITY_TYPE_MAP.get(type(entity).__name__, type(entity).__name__.lower())


def _coerce(v: Any) -> Any:
    """Rende il valore serializzabile in JSON."""
    if v is None:
        return None
    if isinstance(v, (str, bool, int, float)):
        return v
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    return str(v)


def serialize_entity(entity: Any) -> dict:
    """Snapshot dei soli campi colonna dell'entità."""
    state = inspect(entity)
    out = {}
    for col in state.mapper.columns:
        name = col.key
        out[name] = _coerce(getattr(entity, name))

    # esempi e motivazioni vanno nello snapshot della Answer
    if type(entity).__name__ == "Answer":
        examples = []
        for ex in sorted(entity.examples, key=lambda e: (e.number or "", e.id or 0)):
            examples.append({
                "number": ex.number or "",
                "textarea": ex.textarea or "",
                "transliteration": ex.transliteration or "",
                "gloss": ex.gloss or "",
                "translation": ex.translation or "",
                "reference": ex.reference or "",
            })
        out["examples"] = examples
        out["motivation_codes"] = sorted(
            am.motivation.code for am in entity.answer_motivations if am.motivation
        )

    if type(entity).__name__ == "Question":
        out["allowed_motivation_codes"] = sorted(
            am.motivation.code for am in entity.allowed_motivations if am.motivation
        )

    return out


def _entity_id_for(entity: Any, snapshot: dict) -> str:
    """Id leggibile per entity_id (Answer: lingua:domanda)."""
    if type(entity).__name__ == "Answer":
        return f"{snapshot.get('language_id', '')}:{snapshot.get('question_id', '')}"
    return str(snapshot.get("id", ""))


def record_version(
    db: Session,
    entity: Any,
    operation: str = "update",
    source: str = "manual",
    user_id: Optional[int] = None,
    note: Optional[str] = None,
    flush: bool = True,
) -> "models.EntityVersion":
    """Aggiunge una versione; non committa."""
    snapshot = serialize_entity(entity)
    entity_type = _entity_type_for(entity)
    entity_id = _entity_id_for(entity, snapshot)

    version = models.EntityVersion(
        entity_type=entity_type,
        entity_id=entity_id,
        snapshot=snapshot,
        operation=operation,
        source=source,
        user_id=user_id,
        note=note,
    )
    db.add(version)
    if flush:
        db.flush()
    return version


def get_previous_version(
    db: Session, entity_type: str, entity_id: str, before_id: int
) -> Optional["models.EntityVersion"]:
    return (
        db.query(models.EntityVersion)
        .filter(
            models.EntityVersion.entity_type == entity_type,
            models.EntityVersion.entity_id == entity_id,
            models.EntityVersion.id < before_id,
        )
        .order_by(models.EntityVersion.id.desc())
        .first()
    )


def compute_diff(prev: Optional[dict], curr: dict) -> dict:
    """Diff campo-per-campo fra due snapshot: {campo: {"old": ..., "new": ...}}."""
    diff = {}
    if prev is None:
        for k, v in curr.items():
            if v not in (None, ""):
                diff[k] = {"old": None, "new": v}
        return diff
    keys = set(prev.keys()) | set(curr.keys())
    for k in keys:
        a, b = prev.get(k), curr.get(k)
        if a != b:
            diff[k] = {"old": a, "new": b}
    return diff
