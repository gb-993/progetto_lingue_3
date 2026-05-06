from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

import auth
import models
from dependencies import get_db
from rate_limit import limiter

router = APIRouter(prefix="/auth", tags=["Auth"])


class LoginRequest(BaseModel):
    email: str
    password: str


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

