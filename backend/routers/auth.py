import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

import auth
import models
from dependencies import get_db
from rate_limit import limiter
from services.email_service import send_email
from services.password_reset import RESET_TOKEN_TTL, build_link, hash_token, issue_token
from time_utils import utc_now


logger = logging.getLogger(__name__)


router = APIRouter(prefix="/auth", tags=["Auth"])


class LoginRequest(BaseModel):
    email: str
    password: str


class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


@router.post("/login")
@limiter.limit("5/minute")
def login(request: Request, req: LoginRequest, db: Session = Depends(get_db)):
    email = (req.email or "").strip().lower()
    user = db.query(models.User).filter(models.User.email == email).first()
    if not user or not auth.verify_password(req.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Wrong email or password")
    if user.is_active is False:
        raise HTTPException(status_code=403, detail="This account is disabled. Contact an administrator.")

    access_token = auth.token_for_user(user)
    return {"access_token": access_token, "token_type": "bearer", "role": user.role, "name": user.name}


@router.post("/forgot-password")
@limiter.limit("5/minute")
def forgot_password(
    request: Request,
    req: ForgotPasswordRequest,
    db: Session = Depends(get_db),
):

    email = (req.email or "").strip().lower()
    user = db.query(models.User).filter(models.User.email == email).first()

    if not user or user.is_active is False:
        logger.info("forgot-password: email non registrata o disattivata (%s) — risposta 200 silente.", email)
        return {"detail": "If the email is registered, you will receive a link to reset your password."}

    token_clear = issue_token(
        db, user, ttl=RESET_TOKEN_TTL,
        request_ip=request.client.host if request.client else None,
    )

    reset_link = build_link(token_clear)
    body_text = (
        f"Hi,\n\n"
        f"we received a request to reset the password "
        f"for your PCM-Hub account ({email}).\n\n"
        f"Click the link below to set a new password "
        f"(valid for {int(RESET_TOKEN_TTL.total_seconds() // 60)} minutes):\n\n"
        f"{reset_link}\n\n"
        f"If you didn't request this reset, you can ignore this email: "
        f"your current password remains valid.\n\n"
        f"-- PCM-Hub"
    )
    send_email(
        to=email,
        subject="PCM-Hub — reset your password",
        body_text=body_text,
    )

    return {"detail": "If the email is registered, you will receive a link to reset your password."}


@router.post("/reset-password")
@limiter.limit("10/minute")
def reset_password(
    request: Request,
    req: ResetPasswordRequest,
    db: Session = Depends(get_db),
):
    MIN_PASSWORD_LENGTH = 8
    if len(req.new_password or "") < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Password too short (minimum {MIN_PASSWORD_LENGTH} characters).",
        )

    token_hash = hash_token(req.token or "")
    db_token = (
        db.query(models.PasswordResetToken)
        .filter(models.PasswordResetToken.token_hash == token_hash)
        .first()
    )

    invalid_msg = "Reset link invalid or expired. Please request a new one."
    if not db_token:
        raise HTTPException(status_code=400, detail=invalid_msg)
    if db_token.used_at is not None:
        raise HTTPException(status_code=400, detail=invalid_msg)
    if db_token.expires_at < utc_now():
        raise HTTPException(status_code=400, detail=invalid_msg)

    user = db.query(models.User).filter(models.User.id == db_token.user_id).first()
    if not user:
        raise HTTPException(status_code=400, detail=invalid_msg)

    user.hashed_password = auth.get_password_hash(req.new_password)
    db_token.used_at = utc_now()
    db.commit()

    logger.info("Password reimpostata per %s (token id=%s).", user.email, db_token.id)
    return {"detail": "Password updated. You can now log in with your new password."}
