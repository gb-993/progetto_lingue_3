"""
avviso di modifica concorrente.
"""
import logging
from datetime import timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel, field_validator
from sqlalchemy import func
from sqlalchemy.orm import Session

import models
from time_utils import utc_now
from dependencies import get_db, get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/presence", tags=["Presence"])

PRESENCE_TTL_SECONDS = 25

_ALLOWED_ENTITY_TYPES = {"question", "parameter", "language", "language_parameter"}


class PresencePayload(BaseModel):
    entity_type: str
    entity_id: str

    @field_validator("entity_type")
    @classmethod
    def _valid_type(cls, v):
        v = (v or "").strip()
        if v not in _ALLOWED_ENTITY_TYPES:
            raise ValueError("Unsupported entity_type")
        return v

    @field_validator("entity_id")
    @classmethod
    def _valid_id(cls, v):
        v = (v or "").strip()
        if not v or len(v) > 40:
            raise ValueError("Invalid entity_id")
        return v


@router.post("/heartbeat")
def heartbeat(
    payload: PresencePayload,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    now = utc_now()
    cutoff = now - timedelta(seconds=PRESENCE_TTL_SECONDS)

    row = db.query(models.EditingSession).filter(
        models.EditingSession.entity_type == payload.entity_type,
        models.EditingSession.entity_id == payload.entity_id,
        models.EditingSession.user_id == current_user.id,
    ).first()
    if row:
        row.last_heartbeat = now
    else:
        db.add(models.EditingSession(
            entity_type=payload.entity_type,
            entity_id=payload.entity_id,
            user_id=current_user.id,
            last_heartbeat=now,
        ))

    db.query(models.EditingSession).filter(
        models.EditingSession.entity_type == payload.entity_type,
        models.EditingSession.entity_id == payload.entity_id,
        models.EditingSession.last_heartbeat < cutoff,
    ).delete(synchronize_session=False)

    db.commit()

    others = db.query(func.count(func.distinct(models.EditingSession.user_id))).filter(
        models.EditingSession.entity_type == payload.entity_type,
        models.EditingSession.entity_id == payload.entity_id,
        models.EditingSession.user_id != current_user.id,
        models.EditingSession.last_heartbeat >= cutoff,
    ).scalar() or 0

    return {"others": int(others)}


@router.post("/leave")
def leave(
    payload: PresencePayload,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):

    db.query(models.EditingSession).filter(
        models.EditingSession.entity_type == payload.entity_type,
        models.EditingSession.entity_id == payload.entity_id,
        models.EditingSession.user_id == current_user.id,
    ).delete(synchronize_session=False)
    db.commit()
    return {"ok": True}
