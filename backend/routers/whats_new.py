
import re
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

import models
from dependencies import get_db, get_current_user, require_super_admin
from time_utils import utc_now

router = APIRouter(tags=["What's New"])

WHATS_NEW_KEY = "whats_new"
WHATS_NEW_AUDIENCE_KEY = "whats_new_audience"
_VALID_AUDIENCES = ("all", "admins")
_DEFAULT_AUDIENCE = "all"

_TAG_RE = re.compile(r"<[^>]*>")
_NBSP_RE = re.compile(r"&nbsp;", re.IGNORECASE)


def _has_real_text(html: str) -> bool:
    if not html:
        return False
    stripped = _NBSP_RE.sub(" ", _TAG_RE.sub("", html))
    return len(stripped.strip()) > 0


class WhatsNewUpdate(BaseModel):
    content: str
    audience: Optional[str] = None

    @field_validator("audience")
    @classmethod
    def _valid_audience(cls, v):
        if v is None:
            return None
        v = (v or "").strip().lower()
        if v not in _VALID_AUDIENCES:
            raise ValueError("audience must be 'all' or 'admins'")
        return v


def _get_row(db: Session):
    return (
        db.query(models.SiteContent)
        .filter(models.SiteContent.key == WHATS_NEW_KEY)
        .first()
    )


def _get_audience(db: Session) -> str:
    row = (
        db.query(models.SiteContent)
        .filter(models.SiteContent.key == WHATS_NEW_AUDIENCE_KEY)
        .first()
    )
    val = (row.content or "").strip().lower() if row else ""
    return val if val in _VALID_AUDIENCES else _DEFAULT_AUDIENCE


def _content_visible_to(is_admin: bool, audience: str) -> bool:
    return is_admin or audience == "all"


def _user_should_see(db: Session, user_id: int, updated_at) -> bool:
    if updated_at is None:
        return False
    view = (
        db.query(models.WhatsNewView)
        .filter(models.WhatsNewView.user_id == user_id)
        .first()
    )
    if view and view.seen_version is not None and view.seen_version >= updated_at:
        return False
    return True


@router.get("/api/whats-new")
def get_whats_new(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):

    row = _get_row(db)
    audience = _get_audience(db)
    is_admin = current_user.role == "admin"
    visible = _content_visible_to(is_admin, audience)
    if not row:
        return {"content": "", "updated_at": None, "should_show": False, "audience": audience}
    content = row.content or ""
    should_show = (
        visible
        and _has_real_text(content)
        and _user_should_see(db, current_user.id, row.updated_at)
    )
    return {
        "content": content if visible else "",
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        "should_show": should_show,
        "audience": audience,
    }


@router.post("/api/whats-new/seen")
def mark_whats_new_seen(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    
    row = _get_row(db)
    if not row or row.updated_at is None:
        return {"detail": "Nothing to mark."}
    now = utc_now()
    view = (
        db.query(models.WhatsNewView)
        .filter(models.WhatsNewView.user_id == current_user.id)
        .first()
    )
    if view:
        view.seen_version = row.updated_at
        view.seen_at = now
    else:
        view = models.WhatsNewView(
            user_id=current_user.id,
            seen_version=row.updated_at,
            seen_at=now,
        )
        db.add(view)
    db.commit()
    return {"detail": "Marked as seen."}


@router.put("/api/admin/whats-new")
def update_whats_new(
    data: WhatsNewUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_super_admin),
):

    row = _get_row(db)
    now = utc_now()
    if not row:
        row = models.SiteContent(
            key=WHATS_NEW_KEY,
            page="whats_new",
            content=data.content,
            updated_by_id=current_user.id,
        )
        db.add(row)
    else:
        row.content = data.content
        row.updated_by_id = current_user.id
        row.updated_at = now

    if data.audience is not None:
        arow = (
            db.query(models.SiteContent)
            .filter(models.SiteContent.key == WHATS_NEW_AUDIENCE_KEY)
            .first()
        )
        if not arow:
            db.add(models.SiteContent(
                key=WHATS_NEW_AUDIENCE_KEY,
                page="whats_new",
                content=data.audience,
                updated_by_id=current_user.id,
            ))
        else:
            arow.content = data.audience
            arow.updated_by_id = current_user.id

    db.commit()
    return {"detail": "What's New updated."}
