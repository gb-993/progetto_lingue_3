import os

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

import auth
import models
from database import SessionLocal


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# Schema per estrarre il token dalle richieste (cerca l'header Authorization: Bearer <token>)
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


def resolve_user_from_sub(db: Session, sub) -> models.User | None:
    """Risolve il claim `sub` del JWT nell'utente corrispondente.

    Token nuovi: sub = id numerico dell'utente. Stabile per sempre: cambiare
    email dal profilo non invalida piu' la sessione.
    Token emessi prima di questo cambio: sub = email. Il fallback li tiene
    validi (in prod durano un anno: senza, al deploy verrebbero sloggati
    tutti). Nessuna ambiguita': un'email contiene sempre '@', non puo'
    essere una stringa di sole cifre.

    Usata sia da get_current_user che dal middleware consensi
    (consent_enforcement.py): i due DEVONO risolvere l'utente allo stesso
    modo, altrimenti un token valido qui potrebbe non essere riconosciuto
    la' e bypassare il check consensi.
    """
    if sub is None:
        return None
    s = str(sub)
    if s.isdigit():
        return db.query(models.User).filter(models.User.id == int(s)).first()
    return db.query(models.User).filter(models.User.email == s).first()


# ==========================================
# DIPENDENZE PER L'AUTENTICAZIONE
# ==========================================
def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        # Decodifica il token JWT usando le impostazioni del tuo file auth.py
        payload = jwt.decode(token, auth.SECRET_KEY, algorithms=[auth.ALGORITHM])
        sub = payload.get("sub")
        if sub is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    # Cerca l'utente nel database (id per i token nuovi, email per i legacy)
    user = resolve_user_from_sub(db, sub)
    if user is None:
        raise credentials_exception
    return user


def require_admin(current_user: models.User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. This operation is allowed only to administrators.",
        )
    return current_user


# ==========================================
# SUPER-ADMIN: subset di admin che ha accesso anche a operazioni "pericolose"
# (Migration Import del bundle legacy, Backup Restore con wipe).
#
# Identificato come l'admin la cui email coincide con ADMIN_EMAIL — la stessa
# env var gia' usata da `_ensure_default_admin` per il bootstrap del primo
# account admin. In pratica: il super-admin e' il proprietario dell'account
# admin "di default" creato al primo avvio. Nessuna nuova env da configurare,
# nessuna colonna DB.
#
# Conseguenza: se un giorno l'utente cambia l'email del suo profilo ma non
# aggiorna ADMIN_EMAIL nel .env, perdera' lo status di super-admin finche'
# le due non tornano allineate.
# ==========================================
def is_super_admin(user: models.User) -> bool:
    if user is None or user.role != "admin":
        return False
    expected = (os.getenv("ADMIN_EMAIL", "") or "").strip().lower()
    if not expected:
        return False
    return (user.email or "").strip().lower() == expected


def require_super_admin(current_user: models.User = Depends(get_current_user)):
    if not is_super_admin(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. This operation is allowed only to super-administrators.",
        )
    return current_user

