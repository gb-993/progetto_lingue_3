from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
import models
import auth
from dependencies import get_db, require_admin, get_current_user

router = APIRouter(tags=["Users"])

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
        raise HTTPException(status_code=404, detail="Utente non trovato")
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
    if db.query(models.User).filter(models.User.email == data.email.lower()).first():
        raise HTTPException(status_code=400, detail="Questa email è già registrata.")

    new_user = models.User(
        email=data.email.lower(),
        hashed_password=auth.get_password_hash(data.password),
        role=data.role,
        name=data.name,
        surname=data.surname
    )
    db.add(new_user)
    db.commit()
    return {"detail": "Account creato con successo."}

@router.put("/api/admin/accounts/{user_id}/languages")
def assign_languages(user_id: int, data: LanguageAssign, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    """Assegna un pool di lingue a un utente standard"""
    target_user = db.query(models.User).filter(models.User.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="Utente non trovato.")
    if target_user.role == "admin":
        raise HTTPException(status_code=400, detail="Gli admin hanno già accesso globale a tutte le lingue.")

    # 1. Rimuove tutte le assegnazioni correnti per questo utente
    db.query(models.Language).filter(models.Language.assigned_user_id == user_id).update({"assigned_user_id": None})

    # 2. Assegna le nuove lingue (se fornite)
    if data.language_ids:
        # Assicurati che le lingue richieste esistano
        db.query(models.Language).filter(models.Language.id.in_(data.language_ids)).update({"assigned_user_id": user_id})

    db.commit()
    return {"detail": "Lingue assegnate con successo."}

@router.delete("/api/admin/accounts/{user_id}")
def delete_account(user_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    """Elimina un account con salvaguardie"""
    target_user = db.query(models.User).filter(models.User.id == user_id).first()

    if not target_user:
        raise HTTPException(status_code=404, detail="Utente non trovato.")

    # SALVAGUARDIA 1: Non puoi eliminare te stesso
    if target_user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Non puoi eliminare il tuo stesso account. Fallo fare a un altro admin.")

    # SALVAGUARDIA 2: Deve restare sempre almeno un admin
    if target_user.role == "admin":
        admin_count = db.query(models.User).filter(models.User.role == "admin").count()
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="Operazione bloccata: non puoi eliminare l'ultimo amministratore rimasto.")

    # Svincola le lingue prima di eliminare
    db.query(models.Language).filter(models.Language.assigned_user_id == user_id).update({"assigned_user_id": None})

    db.delete(target_user)
    db.commit()
    return {"detail": "Account eliminato con successo."}

# ==========================================
# ENDPOINT USER: IL MIO ACCOUNT (Invariati)
# ==========================================
@router.get("/api/me")
def get_my_account(current_user: models.User = Depends(get_current_user)):
    return {
        "id": current_user.id, "email": current_user.email,
        "name": current_user.name, "surname": current_user.surname, "role": current_user.role
    }

@router.put("/api/me")
def update_my_profile(data: ProfileUpdate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    if data.email.lower() != current_user.email.lower():
        existing_user = db.query(models.User).filter(models.User.email == data.email.lower()).first()
        if existing_user:
            raise HTTPException(status_code=400, detail="Questa email è già in uso da un altro utente.")

    current_user.name = data.name
    current_user.surname = data.surname
    current_user.email = data.email.lower()
    db.commit()
    return {"detail": "Profilo aggiornato con successo."}

@router.put("/api/me/password")
def update_my_password(data: PasswordUpdate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    if data.new_password1 != data.new_password2:
        raise HTTPException(status_code=400, detail="Le nuove password non coincidono.")
    if not auth.verify_password(data.old_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="La password corrente è errata.")

    current_user.hashed_password = auth.get_password_hash(data.new_password1)
    db.commit()
    return {"detail": "Password aggiornata con successo."}