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
    """
    Risolve un utente dal sub del JWT (id numerico o email).
    Restituisce None se non esiste.
    """
    if sub is None:
        return None
    s = str(sub)
    if s.isdigit():
        return db.query(models.User).filter(models.User.id == int(s)).first()
    return db.query(models.User).filter(models.User.email == s).first()


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, auth.SECRET_KEY, algorithms=[auth.ALGORITHM])
        sub = payload.get("sub")
        if sub is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

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

