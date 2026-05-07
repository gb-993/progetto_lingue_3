"""
Bootstrap del primo admin all'avvio dell'app.

Il primo deploy (locale o in produzione) parte con la tabella `users`
vuota: senza un admin nessuno puo' loggare e l'unica via di accesso
sarebbe creare l'utente a mano col `docker exec` sulla console del
container. Per evitarlo, all'avvio FastAPI esegue questo bootstrap:

  - se la tabella `users` e' vuota -> crea un admin con
    `ADMIN_EMAIL`/`ADMIN_PASSWORD` (in dev fallback a `admin@local`/`admin`);
  - se esiste anche un solo utente -> NO-OP: niente sovrascritture,
    niente reset password, niente log rumorosi. Idempotente sui
    riavvii successivi del container.

Affine a `_ensure_default_admin` di services/migration_import.py: entrambi
sono idempotenti e creano l'admin di env solo se manca, senza mai toccare
record gia' presenti. Quel secondo gira a fine import bundle, questo
all'avvio del processo.
"""
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
    """Crea il primo admin se la tabella users e' vuota. No-op altrimenti."""
    db: Session = SessionLocal()
    try:
        if db.query(models.User).first() is not None:
            return

        email = (ADMIN_EMAIL or "admin@local").strip().lower()
        password = ADMIN_PASSWORD or "admin"

        # Difesa in profondita': il guard sta gia' in config.py, ma qui
        # ribadiamo per essere certi che in prod non si arrivi mai a
        # creare l'admin con le credenziali di fallback dev.
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
