"""Timestamp UTC al posto di datetime.utcnow() (deprecato)."""
from datetime import datetime, timezone

__all__ = ["utc_now"]


def utc_now() -> datetime:
    """Datetime naive in UTC, qualunque sia il fuso del container."""
    return datetime.now(timezone.utc).replace(tzinfo=None)
