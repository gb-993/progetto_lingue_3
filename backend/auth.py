import bcrypt
from datetime import datetime, timedelta
from typing import Optional
from jose import jwt

from config import SECRET_KEY, ALGORITHM, ACCESS_TOKEN_EXPIRE_MINUTES

__all__ = [
    "SECRET_KEY",
    "ALGORITHM",
    "ACCESS_TOKEN_EXPIRE_MINUTES",
    "verify_password",
    "get_password_hash",
    "create_access_token",
]


def verify_password(plain_password: str, hashed_password: str) -> bool:
    # Controlla la password
    return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))


def get_password_hash(password: str) -> str:
    # Cripta la password
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    # Genera il token JWT.
    # Se non viene passato `expires_delta` usiamo ACCESS_TOKEN_EXPIRE_MINUTES
    # (prima il default era 15 min, incoerente con la costante).
    to_encode = data.copy()
    expire = datetime.utcnow() + (
        expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
