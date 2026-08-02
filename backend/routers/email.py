
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
    if not SMTP_ENABLED:
        raise HTTPException(
            status_code=503,
            detail=(
                "SMTP not configured. Set SMTP_HOST, SMTP_PORT, "
                "SMTP_USER, SMTP_PASSWORD and SMTP_FROM (in dev via .env, "
                "in prod via the Portainer stack environment)."
            ),
        )

    subject = "PCM-Hub — test email"
    body_text = (
        f"This is a test email sent from PCM-Hub.\n\n"
        f"If you're reading this, the SMTP configuration is working.\n\n"
        f"Requested by: {current_user.email}\n"
    )
    ok = send_email(to=data.to, subject=subject, body_text=body_text)
    if not ok:
        raise HTTPException(
            status_code=502,
            detail=(
                "Sending failed: check the backend logs for the reason "
                "(credentials, unreachable host, etc.)."
            ),
        )
    return {"detail": f"Test email sent to {data.to}."}
