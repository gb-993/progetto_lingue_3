"""Servizio di invio mail transazionali via SMTP."""
from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage

from config import (
    SMTP_ENABLED,
    SMTP_FROM,
    SMTP_HOST,
    SMTP_PASSWORD,
    SMTP_PORT,
    SMTP_USER,
)


logger = logging.getLogger(__name__)


def send_email(
    to: str,
    subject: str,
    body_text: str,
    body_html: str | None = None,
) -> bool:
    """Invia una mail e ritorna True/False; su SMTP down o credenziali sbagliate non solleva, logga l'errore e ritorna False."""
    if not SMTP_ENABLED:
        logger.warning(
            "SMTP non configurato, skip invio mail a %s (subject=%r). "
            "Imposta SMTP_HOST/SMTP_USER/SMTP_PASSWORD/SMTP_FROM in .env.",
            to, subject,
        )
        return False

    message = EmailMessage()
    message["From"] = SMTP_FROM
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body_text)
    if body_html:
        message.add_alternative(body_html, subtype="html")

    try:
        if SMTP_PORT == 465:
            with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=20) as server:
                server.login(SMTP_USER, SMTP_PASSWORD)
                server.send_message(message)
        else:
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as server:
                server.ehlo()
                server.starttls()
                server.ehlo()
                server.login(SMTP_USER, SMTP_PASSWORD)
                server.send_message(message)
        logger.info("Mail inviata a %s (subject=%r).", to, subject)
        return True
    except Exception as exception:
        logger.error(
            "Invio mail fallito (to=%s, subject=%r): %s",
            to, subject, exception,
            exc_info=True,
        )
        return False
