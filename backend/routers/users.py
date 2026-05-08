import re

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
import models
import auth
from dependencies import get_db, require_admin, get_current_user, is_super_admin

router = APIRouter(tags=["Users"])


# Politica password: minimo MIN_PASSWORD_LENGTH caratteri.
# Si applica solo quando una password viene scelta o cambiata: gli account
# esistenti con password piu' corte continuano a funzionare finche' non
# decidono di cambiarla (no reset forzato al go-live).
MIN_PASSWORD_LENGTH = 8


def _validate_password(password: str) -> None:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Password too short (minimum {MIN_PASSWORD_LENGTH} characters).",
        )


# Validazione email server-side. Pattern minimo: qualcosa@qualcosa.qualcosa
# senza spazi e senza @ multiple. Non vuole sostituire un check completo
# RFC 5322 (servirebbe la lib email-validator), copre invece il 99% dei
# typo reali — in particolare il "dimenticato il TLD" (es. "user@unimore"
# invece di "user@unimore.it") che il <input type="email"> del browser
# lascia passare.
# Difese complementari: <input type="email"> lato form (AccountCreate,
# MyAccount), e in AccountCreate la tendina dei ruoli previene altri
# input fuori range.
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _validate_email(email: str) -> None:
    if not _EMAIL_RE.match(email or ""):
        raise HTTPException(
            status_code=400,
            detail="Invalid email format.",
        )

# --- SCHEMI PYDANTIC ---
class ProfileUpdate(BaseModel):
    name: str
    surname: str
    email: str

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

# ==========================================
# ENDPOINT ADMIN: GESTIONE ACCOUNT
# ==========================================
@router.get("/api/admin/accounts")
def get_all_accounts(db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    """Restituisce tutti gli utenti con le relative lingue assegnate"""
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
    """Recupera i dati di un singolo utente per assegnargli le lingue"""
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
def create_account(data: AccountCreate, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    """Crea un nuovo utente (Admin o User)"""
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
    return {"detail": "Account successfully created."}

@router.put("/api/admin/accounts/{user_id}/languages")
def assign_languages(user_id: int, data: LanguageAssign, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    """Assegna un pool di lingue a un utente standard"""
    target_user = db.query(models.User).filter(models.User.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found.")
    if target_user.role == "admin":
        raise HTTPException(status_code=400, detail="Admins already have global access to all languages.")

    # 1. Rimuove tutte le assegnazioni correnti per questo utente
    db.query(models.Language).filter(models.Language.assigned_user_id == user_id).update({"assigned_user_id": None})

    # 2. Assegna le nuove lingue (se fornite)
    if data.language_ids:
        # Assicurati che le lingue richieste esistano
        db.query(models.Language).filter(models.Language.id.in_(data.language_ids)).update({"assigned_user_id": user_id})

    db.commit()
    return {"detail": "Languages assigned successfully."}

@router.delete("/api/admin/accounts/{user_id}")
def delete_account(user_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    """Elimina un account con salvaguardie"""
    target_user = db.query(models.User).filter(models.User.id == user_id).first()

    if not target_user:
        raise HTTPException(status_code=404, detail="User not found.")

    # SALVAGUARDIA 1: Non puoi eliminare te stesso
    if target_user.id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account. Ask another admin to do it.")

    # SALVAGUARDIA 2: Deve restare sempre almeno un admin
    if target_user.role == "admin":
        admin_count = db.query(models.User).filter(models.User.role == "admin").count()
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="Operation blocked: you cannot delete the last remaining administrator.")

    # Svincola le lingue prima di eliminare
    db.query(models.Language).filter(models.Language.assigned_user_id == user_id).update({"assigned_user_id": None})

    db.delete(target_user)
    db.commit()
    return {"detail": "Account deleted successfully."}

# ==========================================
# ENDPOINT USER: IL MIO ACCOUNT (Invariati)
# ==========================================
@router.get("/api/me")
def get_my_account(current_user: models.User = Depends(get_current_user)):
    return {
        "id": current_user.id, "email": current_user.email,
        "name": current_user.name, "surname": current_user.surname, "role": current_user.role,
        # is_super_admin: true se l'utente e' admin E la sua email e' in
        # SUPER_ADMIN_EMAIL (env var, comma-separated). Usato dal frontend
        # per nascondere/proteggere voci sidebar e rotte admin "pericolose"
        # (Migration Import, Backup Restore).
        "is_super_admin": is_super_admin(current_user),
    }

@router.put("/api/me")
def update_my_profile(data: ProfileUpdate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    _validate_email(data.email)
    if data.email.lower() != current_user.email.lower():
        existing_user = db.query(models.User).filter(models.User.email == data.email.lower()).first()
        if existing_user:
            raise HTTPException(status_code=400, detail="This email is already in use by another user.")

    current_user.name = data.name
    current_user.surname = data.surname
    current_user.email = data.email.lower()
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
    return {"detail": "Password updated successfully."}