from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from pydantic import BaseModel
from jose import JWTError, jwt
import models, auth
from sqlalchemy.exc import IntegrityError
from database import SessionLocal, engine
from typing import Optional

app = FastAPI(title="PCM-Hub API")

# Abilita le chiamate dal frontend React
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Schema per estrarre il token dalle richieste (cerca l'header Authorization: Bearer <token>)
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

# ==========================================
# DIPENDENZE PER L'AUTENTICAZIONE
# ==========================================
def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Credenziali non valide",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        # Decodifica il token JWT usando le impostazioni del tuo file auth.py
        payload = jwt.decode(token, auth.SECRET_KEY, algorithms=[auth.ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    # Cerca l'utente nel database
    user = db.query(models.User).filter(models.User.email == email).first()
    if user is None:
        raise credentials_exception
    return user

def require_admin(current_user: models.User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Accesso negato. Operazione consentita solo agli amministratori."
        )
    return current_user

# ==========================================
# SCHEMI PYDANTIC
# ==========================================
class LoginRequest(BaseModel):
    email: str
    password: str

class GlossaryBase(BaseModel):
    word: str
    description: str

class LanguageBase(BaseModel):
    id: str
    name_full: str
    position: int
    family: str = ""
    top_level_family: str = ""
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    historical_language: bool = False
    assigned_user_id: Optional[int] = None

class ParameterBase(BaseModel):
    id: str
    name: str
    position: int
    short_description: str = ""
    implicational_condition: Optional[str] = None
    is_active: bool = True
    schema: str = ""
    param_type: str = ""
    level_of_comparison: str = ""


def validate_coordinates(latitude: Optional[float], longitude: Optional[float]):
    if latitude is not None and not -90 <= latitude <= 90:
        raise HTTPException(status_code=422, detail="La latitudine deve essere compresa tra -90 e 90")
    if longitude is not None and not -180 <= longitude <= 180:
        raise HTTPException(status_code=422, detail="La longitudine deve essere compresa tra -180 e 180")


def ensure_assigned_user_exists(user_id: Optional[int], db: Session):
    if user_id is None:
        return
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utente assegnato non trovato")

# ==========================================
# ENDPOINT PUBBLICI / AUTH
# ==========================================
@app.post("/auth/login")
def login(req: LoginRequest, db: Session = Depends(get_db)):
    # Ora usiamo req.email e req.password
    user = db.query(models.User).filter(models.User.email == req.email).first()
    if not user or not auth.verify_password(req.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Email o password errati")

    access_token = auth.create_access_token(data={"sub": user.email, "role": user.role})
    return {"access_token": access_token, "token_type": "bearer", "role": user.role, "name": user.name}

@app.get("/api/public/languages")
def get_public_languages(db: Session = Depends(get_db)):
    langs = db.query(models.Language).all()
    return [{
        "id": l.id,
        "name": l.name_full,
        "lat": float(l.latitude) if l.latitude else None,
        "lng": float(l.longitude) if l.longitude else None,
        "family": l.top_level_family
    } for l in langs]

# ==========================================
# ENDPOINT PROTETTI (SOLO ADMIN) - GLOSSARIO
# ==========================================
@app.get("/api/admin/glossary")
def get_admin_glossary(db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    glossary_items = db.query(models.Glossary).order_by(models.Glossary.word).all()
    return glossary_items

@app.get("/api/admin/glossary/{id}")
def get_glossary_term(id: int, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    item = db.query(models.Glossary).filter(models.Glossary.id == id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Termine non trovato")
    return item

@app.post("/api/admin/glossary", status_code=status.HTTP_201_CREATED)
def create_glossary_term(item: GlossaryBase, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    db_item = models.Glossary(word=item.word, description=item.description)
    db.add(db_item)
    try:
        db.commit()
        db.refresh(db_item)
        return db_item
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Questo termine esiste già nel glossario.")

@app.put("/api/admin/glossary/{id}")
def update_glossary_term(id: int, item: GlossaryBase, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    db_item = db.query(models.Glossary).filter(models.Glossary.id == id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Termine non trovato")

    db_item.word = item.word
    db_item.description = item.description
    try:
        db.commit()
        db.refresh(db_item)
        return db_item
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Questo termine esiste già nel glossario.")

@app.delete("/api/admin/glossary/{id}")
def delete_glossary_term(id: int, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    db_item = db.query(models.Glossary).filter(models.Glossary.id == id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Termine non trovato")

    db.delete(db_item)
    db.commit()
    return {"detail": "Termine eliminato con successo"}

# ==========================================
# ENDPOINT PROTETTI (SOLO ADMIN) - LINGUE
# ==========================================
@app.get("/api/admin/languages")
def get_admin_languages(db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    languages = db.query(models.Language).order_by(models.Language.position, models.Language.name_full).all()
    return languages

@app.get("/api/admin/languages/{id}")
def get_admin_language(id: str, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    language = db.query(models.Language).filter(models.Language.id == id).first()
    if not language:
        raise HTTPException(status_code=404, detail="Lingua non trovata")
    return language

@app.post("/api/admin/languages", status_code=status.HTTP_201_CREATED)
def create_admin_language(item: LanguageBase, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    validate_coordinates(item.latitude, item.longitude)
    ensure_assigned_user_exists(item.assigned_user_id, db)

    db_item = models.Language(
        id=item.id,
        name_full=item.name_full,
        position=item.position,
        family=item.family,
        top_level_family=item.top_level_family,
        latitude=item.latitude,
        longitude=item.longitude,
        historical_language=item.historical_language,
        assigned_user_id=item.assigned_user_id,
    )
    db.add(db_item)
    try:
        db.commit()
        db.refresh(db_item)
        return db_item
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Impossibile creare la lingua (ID duplicato o dati non validi).")

@app.put("/api/admin/languages/{id}")
def update_admin_language(id: str, item: LanguageBase, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    db_item = db.query(models.Language).filter(models.Language.id == id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Lingua non trovata")

    validate_coordinates(item.latitude, item.longitude)
    ensure_assigned_user_exists(item.assigned_user_id, db)

    db_item.id = item.id
    db_item.name_full = item.name_full
    db_item.position = item.position
    db_item.family = item.family
    db_item.top_level_family = item.top_level_family
    db_item.latitude = item.latitude
    db_item.longitude = item.longitude
    db_item.historical_language = item.historical_language
    db_item.assigned_user_id = item.assigned_user_id

    try:
        db.commit()
        db.refresh(db_item)
        return db_item
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Impossibile aggiornare la lingua (ID duplicato o dati non validi).")

@app.delete("/api/admin/languages/{id}")
def delete_admin_language(id: str, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    db_item = db.query(models.Language).filter(models.Language.id == id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Lingua non trovata")

    db.delete(db_item)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Impossibile eliminare la lingua: record collegati presenti")
    return {"detail": "Lingua eliminata con successo"}

# ==========================================
# ENDPOINT PROTETTI (SOLO ADMIN) - PARAMETRI
# ==========================================
@app.get("/api/admin/parameters")
def get_admin_parameters(db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    parameters = db.query(models.ParameterDef).order_by(models.ParameterDef.position, models.ParameterDef.id).all()
    return parameters

@app.get("/api/admin/parameters/{id}")
def get_admin_parameter(id: str, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    parameter = db.query(models.ParameterDef).filter(models.ParameterDef.id == id).first()
    if not parameter:
        raise HTTPException(status_code=404, detail="Parametro non trovato")
    return parameter

@app.post("/api/admin/parameters", status_code=status.HTTP_201_CREATED)
def create_admin_parameter(item: ParameterBase, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    db_item = models.ParameterDef(
        id=item.id,
        name=item.name,
        short_description=item.short_description,
        implicational_condition=item.implicational_condition,
        is_active=item.is_active,
        position=item.position,
        schema=item.schema,
        param_type=item.param_type,
        level_of_comparison=item.level_of_comparison,
    )
    db.add(db_item)
    try:
        db.commit()
        db.refresh(db_item)
        return db_item
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Impossibile creare il parametro (ID duplicato o dati non validi).")

@app.put("/api/admin/parameters/{id}")
def update_admin_parameter(id: str, item: ParameterBase, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    db_item = db.query(models.ParameterDef).filter(models.ParameterDef.id == id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Parametro non trovato")

    db_item.id = item.id
    db_item.name = item.name
    db_item.short_description = item.short_description
    db_item.implicational_condition = item.implicational_condition
    db_item.is_active = item.is_active
    db_item.position = item.position
    db_item.schema = item.schema
    db_item.param_type = item.param_type
    db_item.level_of_comparison = item.level_of_comparison

    try:
        db.commit()
        db.refresh(db_item)
        return db_item
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Impossibile aggiornare il parametro (ID duplicato o dati non validi).")

@app.delete("/api/admin/parameters/{id}")
def delete_admin_parameter(id: str, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    db_item = db.query(models.ParameterDef).filter(models.ParameterDef.id == id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Parametro non trovato")

    db.delete(db_item)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Impossibile eliminare il parametro: record collegati presenti")
    return {"detail": "Parametro eliminato con successo"}

# ==========================================
# ENDPOINT PROTETTI (SOLO ADMIN) - ALTRI
# ==========================================
@app.get("/api/admin/questions")
def get_admin_questions(db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    questions = db.query(models.Question).all()
    return questions