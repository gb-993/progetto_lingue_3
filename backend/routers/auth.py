import hashlib
import logging
import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

import auth
import models
from config import SITE_URL
from dependencies import get_db
from rate_limit import limiter
from services.email_service import send_email
from time_utils import utc_now


logger = logging.getLogger(__name__)


router = APIRouter(prefix="/auth", tags=["Auth"])


# Durata di validita' del link di reset password. 30 min e' lo standard:
# abbastanza per leggere la mail con calma, abbastanza poco da limitare
# il danno se la mail viene intercettata.
RESET_TOKEN_TTL = timedelta(minutes=30)


class LoginRequest(BaseModel):
    email: str
    password: str


class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


def _hash_token(token: str) -> str:
    """Hash sha256 del token. Salviamo questo nel DB, mai il clear."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# Rate-limit: 5 tentativi/minuto per IP. slowapi richiede che il primo
# parametro della view sia `request: Request` per leggere l'IP. Quando
# la quota e' superata risponde 429 (handler registrato in main.py).
@router.post("/login")
@limiter.limit("5/minute")
def login(request: Request, req: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == req.email).first()
    if not user or not auth.verify_password(req.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Wrong email or password")

    access_token = auth.create_access_token(data={"sub": user.email, "role": user.role})
    return {"access_token": access_token, "token_type": "bearer", "role": user.role, "name": user.name}


# Rate-limit: 5/min per IP. Difesa contro enumeration brute-force (chi
# prova in massa email per scoprire quali esistono nel sistema). La
# risposta e' SEMPRE 200 indipendentemente dall'esistenza dell'email,
# per non leakare quali account sono registrati.
@router.post("/forgot-password")
@limiter.limit("5/minute")
def forgot_password(
    request: Request,
    req: ForgotPasswordRequest,
    db: Session = Depends(get_db),
):
    """Genera un token di reset e manda la mail con il link.

    Per ragioni di privacy/sicurezza, risponde 200 anche se l'email non
    esiste o se l'invio mail fallisce: dall'esterno non e' possibile
    capire quali account sono registrati ne' se il nostro SMTP e' giu'.
    Gli eventuali errori (SMTP fallito, ecc.) finiscono nei log.
    """
    email = (req.email or "").strip().lower()
    user = db.query(models.User).filter(models.User.email == email).first()

    # NON sollevare se l'utente non esiste: rispondi 200 come se tutto fosse
    # andato bene per non leakare la lista email. Logghiamo solo per debug.
    if not user:
        logger.info("forgot-password: email non registrata (%s) — risposta 200 silente.", email)
        return {"detail": "Se l'email e' registrata, riceverai un link per reimpostare la password."}

    # Token random ad alta entropia: 32 byte url-safe = ~43 caratteri.
    # Vive solo nella mail e in memoria; nel DB salviamo solo lo sha256.
    token_clear = secrets.token_urlsafe(32)
    token_hash = _hash_token(token_clear)
    now = utc_now()

    db_token = models.PasswordResetToken(
        user_id=user.id,
        token_hash=token_hash,
        created_at=now,
        expires_at=now + RESET_TOKEN_TTL,
        request_ip=request.client.host if request.client else None,
    )
    db.add(db_token)
    db.commit()

    reset_link = f"{SITE_URL}/reset-password?token={token_clear}"
    body_text = (
        f"Ciao,\n\n"
        f"abbiamo ricevuto una richiesta di reimpostazione della password "
        f"per il tuo account su PCM-Hub ({email}).\n\n"
        f"Clicca sul link sottostante per impostare una nuova password "
        f"(valido per {int(RESET_TOKEN_TTL.total_seconds() // 60)} minuti):\n\n"
        f"{reset_link}\n\n"
        f"Se non sei stato tu a richiedere il reset, ignora questa mail: "
        f"la tua password attuale rimane valida.\n\n"
        f"-- PCM-Hub"
    )
    send_email(
        to=email,
        subject="PCM-Hub — reimposta la tua password",
        body_text=body_text,
    )

    return {"detail": "Se l'email e' registrata, riceverai un link per reimpostare la password."}


@router.post("/reset-password")
@limiter.limit("10/minute")
def reset_password(
    request: Request,
    req: ResetPasswordRequest,
    db: Session = Depends(get_db),
):
    """Verifica il token e aggiorna la password dell'utente."""
    # Stessa politica del cambio password manuale (vedi routers/users.py).
    MIN_PASSWORD_LENGTH = 8
    if len(req.new_password or "") < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Password too short (minimum {MIN_PASSWORD_LENGTH} characters).",
        )

    token_hash = _hash_token(req.token or "")
    db_token = (
        db.query(models.PasswordResetToken)
        .filter(models.PasswordResetToken.token_hash == token_hash)
        .first()
    )

    # Messaggio generico per token mancante / scaduto / gia' usato: non
    # diamo all'attaccante feedback granulare ("scaduto" vs "inesistente"
    # vs "gia' usato") che potrebbe servirgli per fingerprint.
    invalid_msg = "Link di reset non valido o scaduto. Richiedine uno nuovo."
    if not db_token:
        raise HTTPException(status_code=400, detail=invalid_msg)
    if db_token.used_at is not None:
        raise HTTPException(status_code=400, detail=invalid_msg)
    if db_token.expires_at < utc_now():
        raise HTTPException(status_code=400, detail=invalid_msg)

    user = db.query(models.User).filter(models.User.id == db_token.user_id).first()
    if not user:
        # User cancellato dopo la richiesta di reset: token diventa invalido.
        raise HTTPException(status_code=400, detail=invalid_msg)

    user.hashed_password = auth.get_password_hash(req.new_password)
    db_token.used_at = utc_now()
    db.commit()

    logger.info("Password reimpostata per %s (token id=%s).", user.email, db_token.id)
    return {"detail": "Password aggiornata. Puoi accedere con la nuova password."}
