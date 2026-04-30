"""
Router cronologia versioni (admin only).

Endpoint:
  GET /api/admin/versions               -> lista paginata con filtri
  GET /api/admin/versions/{id}          -> singola versione + diff vs precedente
  GET /api/admin/versions/options       -> popolamento dropdown filtri
  POST /api/admin/versions/{id}/rollback -> placeholder per rollback (non implementato)
"""
from __future__ import annotations
from typing import Optional, List
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_

import models
from dependencies import get_db, require_admin
from services.versioning import (
    get_previous_version,
    compute_diff,
    ENTITY_TYPE_MAP,
)


router = APIRouter(prefix="/api/admin/versions", tags=["History"])


# ============================================================================
# Schemas
# ============================================================================

class VersionSummary(BaseModel):
    id: int
    entity_type: str
    entity_id: str
    operation: str
    source: str
    note: Optional[str] = None
    created_at: str
    user: Optional[dict] = None
    summary_label: str = ""

    class Config:
        from_attributes = True


def _user_dict(u: Optional[models.User]) -> Optional[dict]:
    if not u:
        return None
    full = f"{u.name or ''} {u.surname or ''}".strip() or u.email
    return {"id": u.id, "name": full, "email": u.email}


def _summary_label(v: models.EntityVersion) -> str:
    """Una stringa breve, es. 'FGM — Feature Geometry Marker'."""
    snap = v.snapshot or {}
    if v.entity_type == "parameter":
        return f"{v.entity_id} — {snap.get('name', '')}"
    if v.entity_type == "question":
        text = (snap.get("text", "") or "")[:80]
        return f"{v.entity_id} — {text}"
    if v.entity_type == "motivation":
        return f"{snap.get('code', v.entity_id)} — {snap.get('label', '')[:60]}"
    if v.entity_type == "language":
        return f"{v.entity_id} — {snap.get('name_full', '')}"
    if v.entity_type == "answer":
        resp = snap.get("response_text") or "—"
        return f"{snap.get('language_id', '')} / {snap.get('question_id', '')} ({resp})"
    return v.entity_id


def _to_summary(v: models.EntityVersion) -> dict:
    return {
        "id": v.id,
        "entity_type": v.entity_type,
        "entity_id": v.entity_id,
        "operation": v.operation,
        "source": v.source,
        "note": v.note,
        "created_at": v.created_at.isoformat() if v.created_at else None,
        "user": _user_dict(v.user),
        "summary_label": _summary_label(v),
    }


# ============================================================================
# Endpoint principali
# ============================================================================

@router.get("")
def list_versions(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
    entity_type: Optional[str] = Query(None),
    exclude_entity_type: Optional[str] = Query(None),
    entity_id: Optional[str] = Query(None),
    user_id: Optional[int] = Query(None),
    source: Optional[str] = Query(None),
    operation: Optional[str] = Query(None),
    since: Optional[str] = Query(None, description="ISO date 'YYYY-MM-DD' inclusivo"),
    until: Optional[str] = Query(None, description="ISO date 'YYYY-MM-DD' inclusivo"),
    search: Optional[str] = Query(None, description="Ricerca su entity_id, note, snapshot.name"),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=500),
):
    q = db.query(models.EntityVersion).options(joinedload(models.EntityVersion.user))

    if entity_type:
        q = q.filter(models.EntityVersion.entity_type == entity_type)
    if exclude_entity_type:
        q = q.filter(models.EntityVersion.entity_type != exclude_entity_type)
    if entity_id:
        q = q.filter(models.EntityVersion.entity_id == entity_id)
    if user_id is not None:
        q = q.filter(models.EntityVersion.user_id == user_id)
    if source:
        q = q.filter(models.EntityVersion.source == source)
    if operation:
        q = q.filter(models.EntityVersion.operation == operation)
    if since:
        try:
            d = datetime.fromisoformat(since)
            q = q.filter(models.EntityVersion.created_at >= d)
        except ValueError:
            raise HTTPException(400, f"Formato 'since' non valido: {since}")
    if until:
        try:
            d = datetime.fromisoformat(until)
            # +1 giorno per essere inclusivo
            d_end = d.replace(hour=23, minute=59, second=59)
            q = q.filter(models.EntityVersion.created_at <= d_end)
        except ValueError:
            raise HTTPException(400, f"Formato 'until' non valido: {until}")
    if search:
        like = f"%{search.lower()}%"
        q = q.filter(or_(
            models.EntityVersion.entity_id.ilike(like),
            models.EntityVersion.note.ilike(like),
        ))

    total = q.count()
    rows = (
        q.order_by(models.EntityVersion.created_at.desc(), models.EntityVersion.id.desc())
         .offset((page - 1) * per_page).limit(per_page).all()
    )

    return {
        "total": total,
        "page": page,
        "per_page": per_page,
        "items": [_to_summary(v) for v in rows],
    }


@router.get("/options")
def list_versions_options(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    """Valori distinti per popolare i dropdown dei filtri."""
    types = [r[0] for r in db.query(models.EntityVersion.entity_type).distinct().all() if r[0]]
    sources = [r[0] for r in db.query(models.EntityVersion.source).distinct().all() if r[0]]
    operations = [r[0] for r in db.query(models.EntityVersion.operation).distinct().all() if r[0]]

    # Lista utenti che hanno creato almeno una versione
    user_ids = [r[0] for r in db.query(models.EntityVersion.user_id).distinct().all() if r[0]]
    users = []
    if user_ids:
        for u in db.query(models.User).filter(models.User.id.in_(user_ids)).all():
            users.append(_user_dict(u))

    return {
        "entity_types": sorted(types) or list(ENTITY_TYPE_MAP.values()),
        "sources": sorted(sources),
        "operations": sorted(operations),
        "users": users,
    }


@router.get("/{version_id}")
def get_version_detail(
    version_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    v = (
        db.query(models.EntityVersion)
        .options(joinedload(models.EntityVersion.user))
        .filter(models.EntityVersion.id == version_id)
        .first()
    )
    if not v:
        raise HTTPException(404, "Version not found")

    prev = get_previous_version(db, v.entity_type, v.entity_id, v.id)
    if v.operation == "delete":
        # Per una cancellazione lo snapshot salvato rappresenta lo stato
        # appena prima del delete: nel diff i valori vanno mostrati come
        # "Before", e "Now" è null perché il record non esiste più.
        diff = {
            k: {"old": val, "new": None}
            for k, val in (v.snapshot or {}).items()
            if val not in (None, "")
        }
    else:
        diff = compute_diff(prev.snapshot if prev else None, v.snapshot or {})

    return {
        **_to_summary(v),
        "snapshot": v.snapshot or {},
        "previous_snapshot": (prev.snapshot if prev else None),
        "previous_version_id": prev.id if prev else None,
        "diff": diff,
    }
