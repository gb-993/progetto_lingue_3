"""
Router admin per la diagnostica del servizio email.

Per ora espone un solo endpoint:

  POST /api/admin/email/test
     Manda una mail di prova al destinatario passato nel body.
     Utile per verificare in produzione che SMTP_* sia configurato
     correttamente (host raggiungibile, credenziali valide, ecc.)
     senza dover triggerare un vero flusso utente (reset password, ...).

I flussi reali (reset password, welcome, notifiche admin) verranno
aggiunti man mano e useranno lo stesso `services.email_service.send_email`.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import models
from config import SMTP_ENABLED, SMTP_FROM, SMTP_HOST, SMTP_PORT
from dependencies import require_admin
from services.email_service import send_email


router = APIRouter(prefix="/api/admin/email", tags=["Email"])


class TestEmailRequest(BaseModel):
    to: str


@router.get("/status")
def email_status(current_user: models.User = Depends(require_admin)):
    """Restituisce se SMTP e' attivo e con che parametri (no password)."""
    return {
        "enabled": SMTP_ENABLED,
        "host": SMTP_HOST,
        "port": SMTP_PORT,
        "from": SMTP_FROM,
    }


@router.post("/test")
def send_test_email(
    data: TestEmailRequest,
    current_user: models.User = Depends(require_admin),
):
    """Manda una mail di prova al destinatario indicato."""
    if not SMTP_ENABLED:
        raise HTTPException(
            status_code=503,
            detail=(
                "SMTP non configurato. Imposta SMTP_HOST, SMTP_PORT, "
                "SMTP_USER, SMTP_PASSWORD e SMTP_FROM (in dev nel .env, "
                "in prod nello stack environment di Portainer)."
            ),
        )

    subject = "PCM-Hub — mail di test"
    body_text = (
        f"Questa e' una mail di test inviata da PCM-Hub.\n\n"
        f"Se la stai leggendo significa che la configurazione SMTP funziona.\n\n"
        f"Richiesta da: {current_user.email}\n"
    )
    ok = send_email(to=data.to, subject=subject, body_text=body_text)
    if not ok:
        raise HTTPException(
            status_code=502,
            detail=(
                "Invio fallito: controlla i log del backend per il motivo "
                "(credenziali, host irraggiungibile, ecc.)."
            ),
        )
    return {"detail": f"Mail di test inviata a {data.to}."}
