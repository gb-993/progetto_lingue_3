import logging
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
import models
import auth
from config import SITE_URL
from dependencies import get_db, require_admin, get_current_user, is_super_admin, super_admin_email
from services.email_service import send_email
from services.password_reset import WELCOME_TOKEN_TTL, build_link, issue_token


logger = logging.getLogger(__name__)

router = APIRouter(tags=["Users"])

MIN_PASSWORD_LENGTH = 8


def _validate_password(password: str) -> None:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Password too short (minimum {MIN_PASSWORD_LENGTH} characters).",
        )


_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _validate_email(email: str) -> None:
    if not _EMAIL_RE.match(email or ""):
        raise HTTPException(
            status_code=400,
            detail="Invalid email format.",
        )

class ProfileUpdate(BaseModel):
    name: str
    surname: str
    email: str
    current_password: Optional[str] = None

class PasswordUpdate(BaseModel):
    old_password: str
    new_password1: str
    new_password2: str

class AccountCreate(BaseModel):
    email: str
    password: str
    role: str
    name: str
    surname: str

class LanguageAssign(BaseModel):
    language_ids: list[str]

@router.get("/api/admin/accounts")
def get_all_accounts(db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    users = db.query(models.User).order_by(models.User.role, models.User.surname).all()
    result = []
    for u in users:
        result.append({
            "id": u.id,
            "email": u.email,
            "name": u.name,
            "surname": u.surname,
            "role": u.role,
            "assigned_languages": [l.id for l in u.assigned_languages]
        })
    return result

@router.get("/api/admin/accounts/{user_id}")
def get_single_account(user_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    u = db.query(models.User).filter(models.User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "id": u.id,
        "email": u.email,
        "name": u.name,
        "surname": u.surname,
        "role": u.role,
        "assigned_languages": [l.id for l in u.assigned_languages]
    }

@router.post("/api/admin/accounts", status_code=status.HTTP_201_CREATED)
def create_account(data: AccountCreate, request: Request, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    if data.role not in ("admin", "user"):
        raise HTTPException(status_code=400, detail="Invalid role: must be 'admin' or 'user'.")
    _validate_email(data.email)
    if db.query(models.User).filter(models.User.email == data.email.lower()).first():
        raise HTTPException(status_code=400, detail="This email is already registered.")

    _validate_password(data.password)

    new_user = models.User(
        email=data.email.lower(),
        hashed_password=auth.get_password_hash(data.password),
        role=data.role,
        name=data.name,
        surname=data.surname
    )
    db.add(new_user)
    db.commit()

    token_clear = issue_token(
        db, new_user, ttl=WELCOME_TOKEN_TTL,
        request_ip=request.client.host if request.client else None,
    )
    _send_welcome_email(
        to=new_user.email,
        name=data.name or "",
        link=build_link(token_clear, mode="welcome"),
    )

    return {"detail": "Account successfully created."}


def _send_welcome_email(to: str, name: str, link: str) -> None:

    salutation = f"Hi {name.strip()}," if name and name.strip() else "Hi,"
    valid_hours = int(WELCOME_TOKEN_TTL.total_seconds() // 3600)
    body_text = (
        f"{salutation}\n\n"
        f"your PCM-Hub account has been created.\n\n"
        f"Site: {SITE_URL}\n"
        f"Email: {to}\n\n"
        f"Set your password using the link below (valid for {valid_hours} hours):\n\n"
        f"{link}\n\n"
        f"If the link has expired, use 'Forgot password' on the login page "
        f"to request a new one.\n\n"
        f"-- PCM-Hub"
    )
    send_email(
        to=to,
        subject="Welcome to PCM-Hub",
        body_text=body_text,
    )

@router.put("/api/admin/accounts/{user_id}/languages")
def assign_languages(user_id: int, data: LanguageAssign, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    target_user = db.query(models.User).filter(models.User.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found.")
    if target_user.role == "admin":
        raise HTTPException(status_code=400, detail="Admins already have global access to all languages.")

    db.query(models.Language).filter(models.Language.assigned_user_id == user_id).update({"assigned_user_id": None})

    if data.language_ids:
        db.query(models.Language).filter(models.Language.id.in_(data.language_ids)).update({"assigned_user_id": user_id})

    db.commit()
    return {"detail": "Languages assigned successfully."}

@router.delete("/api/admin/accounts/{user_id}")
def delete_account(user_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    target_user = db.query(models.User).filter(models.User.id == user_id).first()

    if not target_user:
        raise HTTPException(status_code=404, detail="User not found.")

    if is_super_admin(target_user):
        raise HTTPException(status_code=400, detail="The super-administrator account cannot be deleted.")

    if target_user.id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account. Ask another admin to do it.")

    if target_user.role == "admin":
        admin_count = db.query(models.User).filter(models.User.role == "admin").count()
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="Operation blocked: you cannot delete the last remaining administrator.")

    db.query(models.Language).filter(models.Language.assigned_user_id == user_id).update({"assigned_user_id": None})

    db.delete(target_user)
    db.commit()
    return {"detail": "Account deleted successfully."}

@router.get("/api/me")
def get_my_account(current_user: models.User = Depends(get_current_user)):
    return {
        "id": current_user.id, "email": current_user.email,
        "name": current_user.name, "surname": current_user.surname, "role": current_user.role,
        "is_super_admin": is_super_admin(current_user),
    }

@router.put("/api/me")
def update_my_profile(data: ProfileUpdate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    _validate_email(data.email)
    new_email = data.email.lower()
    if new_email != current_user.email.lower():
        reserved_email = super_admin_email()
        if current_user.email.lower() == reserved_email:
            raise HTTPException(
                status_code=400,
                detail="The super-administrator email is set in the server configuration and cannot be changed here.",
            )
        if new_email == reserved_email:
            raise HTTPException(status_code=400, detail="This email address is reserved.")
        if not data.current_password or not auth.verify_password(data.current_password, current_user.hashed_password):
            raise HTTPException(status_code=400, detail="Enter your current password to change the email address.")
        existing_user = db.query(models.User).filter(models.User.email == new_email).first()
        if existing_user:
            raise HTTPException(status_code=400, detail="This email is already in use by another user.")

    current_user.name = data.name
    current_user.surname = data.surname
    current_user.email = new_email
    db.commit()
    return {"detail": "Profile updated successfully."}

@router.put("/api/me/password")
def update_my_password(data: PasswordUpdate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    if data.new_password1 != data.new_password2:
        raise HTTPException(status_code=400, detail="The new passwords do not match.")
    if not auth.verify_password(data.old_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="The current password is wrong.")

    _validate_password(data.new_password1)

    current_user.hashed_password = auth.get_password_hash(data.new_password1)
    db.commit()
    return {
        "detail": "Password updated successfully.",
        "access_token": auth.token_for_user(current_user),
    }