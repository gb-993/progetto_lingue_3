"""
Servizio di versionamento entità.

API principale:
  record_version(db, entity, operation, source, user_id, note) -> EntityVersion

Salva uno snapshot completo dell'entità in `entity_versions`. La timeline è
ricostruibile ordinando per (entity_type, entity_id, created_at).

Usato sia da modifiche manuali (UI) che da import Excel.
"""
from __future__ import annotations
from typing import Any, Optional
from datetime import datetime, date
from decimal import Decimal

from sqlalchemy import inspect
from sqlalchemy.orm import Session

import models


# ============================================================================
# Mapping classe modello -> nome "type" usato in entity_versions.entity_type
# ============================================================================

ENTITY_TYPE_MAP = {
    "ParameterDef": "parameter",
    "Question": "question",
    "Motivation": "motivation",
    "Language": "language",
    "Answer": "answer",
}

# Inverso per recuperare la classe modello da entity_type
MODEL_BY_TYPE = {v: k for k, v in ENTITY_TYPE_MAP.items()}


def _entity_type_for(entity: Any) -> str:
    """Ritorna il valore canonico di `entity_type` per un'istanza modello."""
    return ENTITY_TYPE_MAP.get(type(entity).__name__, type(entity).__name__.lower())


# ============================================================================
# Serializzazione di un'entità in dict JSON-friendly
# ============================================================================

def _coerce(v: Any) -> Any:
    """Converte un valore SQLAlchemy in qualcosa di JSON-serializzabile."""
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
    """
    Snapshot dei campi colonna dell'entità (no relationship, no internal state).

    Per Answer includiamo anche examples e motivation_codes come liste dentro lo
    snapshot: cambiamenti a esempi/motivazioni vanno tracciati come parte della
    Answer stessa, non come entità separate.
    """
    state = inspect(entity)
    out = {}
    for col in state.mapper.columns:
        name = col.key
        out[name] = _coerce(getattr(entity, name))

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

    return out


def _entity_id_for(entity: Any, snapshot: dict) -> str:
    """Identificativo human-readable usato in entity_versions.entity_id."""
    if type(entity).__name__ == "Answer":
        return f"{snapshot.get('language_id', '')}:{snapshot.get('question_id', '')}"
    return str(snapshot.get("id", ""))


# ============================================================================
# API principale
# ============================================================================

def record_version(
    db: Session,
    entity: Any,
    operation: str = "update",
    source: str = "manual",
    user_id: Optional[int] = None,
    note: Optional[str] = None,
    flush: bool = True,
) -> "models.EntityVersion":
    """
    Aggiunge una EntityVersion per `entity`. NON committa: chi chiama
    decide quando committare (all'interno della stessa transazione del save).

    Parametri:
      operation: 'create' | 'update' | 'delete'
      source:    'manual' | 'excel_import' | 'system' | …
      note:      annotazione opzionale dell'admin (es. "Pre-rilascio v2")
    """
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
    """Ritorna la versione precedente a `before_id` per la stessa entità."""
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
    """
    Calcola un diff campo-per-campo tra due snapshot.
    Ritorna dict {campo: {"old": ..., "new": ...}} per i campi cambiati.
    Se prev è None, tutti i campi non-null sono considerati 'new'.
    """
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
