"""
Servizio di invio mail transazionali via SMTP.

Filosofia: una sola funzione `send_email()` che usa `smtplib` della
stdlib (niente dipendenze nuove). Tutta la configurazione arriva da
config.py (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM,
SMTP_ENABLED).

Comportamento se SMTP non e' configurato (dev senza credenziali):
`send_email()` logga un warning e ritorna False — non solleva. Cosi'
gli endpoint che ne dipendono (reset password, welcome, ...) non
crashano in dev e l'utente vede solo che la mail non e' partita.
In prod questa branca non si attiva mai: config.py impone fail-fast
al boot se anche solo una variabile SMTP manca.

Porta: per default 587/STARTTLS (submission moderno). Se SMTP_PORT=465
usiamo SMTP_SSL (TLS implicito). Qualsiasi altra porta -> 587/STARTTLS.
"""
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
    """Invia una mail. Ritorna True se consegnata al server SMTP, False altrimenti.

    - `to`: indirizzo destinatario (singolo).
    - `subject`: oggetto.
    - `body_text`: corpo testuale (sempre presente per i client che non
       supportano HTML / per gli antispam).
    - `body_html`: opzionale, alternativa HTML. Se passata, la mail e'
       multipart/alternative e i client la mostrano al posto del testo.

    NON solleva su SMTP down/credenziali sbagliate: logga l'errore e
    ritorna False. Il chiamante decide se segnalarlo all'utente.
    """
    if not SMTP_ENABLED:
        logger.warning(
            "SMTP non configurato, skip invio mail a %s (subject=%r). "
            "Imposta SMTP_HOST/SMTP_USER/SMTP_PASSWORD/SMTP_FROM in .env.",
            to, subject,
        )
        return False

    msg = EmailMessage()
    msg["From"] = SMTP_FROM
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body_text)
    if body_html:
        msg.add_alternative(body_html, subtype="html")

    try:
        if SMTP_PORT == 465:
            # TLS implicito: connessione gia' cifrata dal primo byte.
            with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=20) as server:
                server.login(SMTP_USER, SMTP_PASSWORD)
                server.send_message(msg)
        else:
            # STARTTLS: si parte in chiaro e si promuove la connessione.
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as server:
                server.ehlo()
                server.starttls()
                server.ehlo()
                server.login(SMTP_USER, SMTP_PASSWORD)
                server.send_message(msg)
        logger.info("Mail inviata a %s (subject=%r).", to, subject)
        return True
    except Exception as exc:
        # Logga in modo "rumoroso" ma non solleva: cosi' un SMTP che va
        # giu' non manda in 500 endpoint utente. Il chiamante riceve False
        # e decide come avvisare l'utente (es. "se l'email esiste, ti
        # arrivera' un link" — non vogliamo nemmeno far capire da fuori
        # che il nostro SMTP e' rotto).
        logger.error(
            "Invio mail fallito (to=%s, subject=%r): %s",
            to, subject, exc,
            exc_info=True,
        )
        return False
