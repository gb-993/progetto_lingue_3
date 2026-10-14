import hashlib
import secrets
from datetime import timedelta
from typing import Optional

from sqlalchemy.orm import Session

import models
from config import SITE_URL
from time_utils import utc_now


RESET_TOKEN_TTL = timedelta(minutes=30)
WELCOME_TOKEN_TTL = timedelta(hours=48)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def issue_token(
    db: Session,
    user: models.User,
    *,
    ttl: timedelta,
    request_ip: Optional[str] = None,
) -> str:
    token_clear = secrets.token_urlsafe(32)
    now = utc_now()

    db.query(models.PasswordResetToken).filter(
        models.PasswordResetToken.user_id == user.id,
        models.PasswordResetToken.used_at.is_(None),
    ).update({"used_at": now})

    db.query(models.PasswordResetToken).filter(
        models.PasswordResetToken.expires_at < now - timedelta(days=30),
    ).delete()

    db.add(models.PasswordResetToken(
        user_id=user.id,
        token_hash=hash_token(token_clear),
        created_at=now,
        expires_at=now + ttl,
        request_ip=request_ip,
    ))
    db.commit()
    return token_clear


def build_link(token: str, *, mode: Optional[str] = None) -> str:
    link = f"{SITE_URL}/reset-password#token={token}"
    return f"{link}&mode={mode}" if mode else link
