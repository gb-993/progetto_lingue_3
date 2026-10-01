from __future__ import annotations
import logging

import bcrypt
from sqlalchemy.orm import Session

import models
from config import ADMIN_EMAIL, ADMIN_PASSWORD, IS_PROD
from database import SessionLocal
from time_utils import utc_now


logger = logging.getLogger(__name__)


def bootstrap_first_admin() -> None:
    """Crea il primo admin se non ci sono utenti."""
    db: Session = SessionLocal()
    try:
        if db.query(models.User).first() is not None:
            return

        email = (ADMIN_EMAIL or "admin@local").strip().lower()
        password = ADMIN_PASSWORD or "admin"

        # sicurezza: in prod mai le credenziali di fallback dev
        if IS_PROD and (not ADMIN_EMAIL or not ADMIN_PASSWORD):
            raise RuntimeError(
                "Bootstrap admin abortito: ADMIN_EMAIL/ADMIN_PASSWORD mancanti in prod."
            )

        hashed = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        admin = models.User(
            email=email,
            hashed_password=hashed,
            name="Admin",
            surname="",
            role="admin",
            terms_accepted=True,
            terms_accepted_at=utc_now(),
            is_active=True,
            date_joined=utc_now(),
        )
        db.add(admin)
        db.commit()

        if IS_PROD:
            logger.warning("Primo admin creato: %s (cambia la password al primo login).", email)
        else:
            logger.warning(
                "Primo admin creato (DEV): %s / %s. NON usare queste credenziali in prod.",
                email, password,
            )
    finally:
        db.close()
