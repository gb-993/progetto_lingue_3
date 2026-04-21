from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

import models
from dependencies import get_db, require_admin
from services.logic_parser import validate_expression, ParseException
router = APIRouter(prefix="/api/admin/parameters", tags=["Parameters"])

# --- SCHEMI PYDANTIC ---

class QuestionRead(BaseModel):
    id: str
    text: str
    is_stop_question: bool
    is_active: bool = True

    class Config:
        from_attributes = True

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

# Nuovo schema per il dettaglio che include le domande
class ParameterDetail(ParameterBase):
    questions: List[QuestionRead] = []

    class Config:
        from_attributes = True

# --- ENDPOINT ---

@router.get("", response_model=List[ParameterBase])
def get_admin_parameters(db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    return db.query(models.ParameterDef).order_by(models.ParameterDef.position, models.ParameterDef.id).all()

@router.get("/{id}", response_model=ParameterDetail)
def get_admin_parameter(id: str, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    # Usiamo joinedload per caricare le domande in un'unica query efficiente
    parameter = db.query(models.ParameterDef).options(joinedload(models.ParameterDef.questions)).filter(models.ParameterDef.id == id).first()
    if not parameter:
        raise HTTPException(status_code=404, detail="Parametro non trovato")
    return parameter

@router.post("", status_code=status.HTTP_201_CREATED)
def create_admin_parameter(item: ParameterBase, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    db_item = models.ParameterDef(**item.dict())
    db.add(db_item)
    # Blocca il salvataggio se il TUDO parser fallisce
    if item.implicational_condition:
        try:
            validate_expression(item.implicational_condition)
        except ParseException as e:
            raise HTTPException(status_code=400, detail=f"Sintassi formula errata: {str(e)}")
    try:
        db.commit()
        db.refresh(db_item)
        return db_item
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="ID duplicato o dati non validi.")

@router.put("/{id}")
def update_admin_parameter(id: str, item: ParameterBase, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    db_item = db.query(models.ParameterDef).filter(models.ParameterDef.id == id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Parametro non trovato")

    for key, value in item.dict().items():
        setattr(db_item, key, value)

    # Blocca il salvataggio se il TUDO parser fallisce
    if item.implicational_condition:
        try:
            validate_expression(item.implicational_condition)
        except ParseException as e:
            raise HTTPException(status_code=400, detail=f"Sintassi formula errata: {str(e)}")

    try:
        db.commit()
        return db_item
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Errore nell'aggiornamento.")



# --- ENDPOINT PER LA VALIDAZIONE SINTASSI IN TEMPO REALE ---
class ConditionCheck(BaseModel):
    condition: str

@router.post("/validate-condition")
def validate_condition_api(payload: ConditionCheck, db: Session = Depends(get_db)):
    if not payload.condition:
        return {"valid": True, "error": None}
    try:
        # Usa ESATTAMENTE la tua funzione!
        validate_expression(payload.condition)
        return {"valid": True, "error": None}
    except ParseException as e:
        return {"valid": False, "error": str(e)}

# --- ENDPOINT "WHERE USED" (Mantenuto perché fa solo una query al DB utilissima) ---
@router.get("/{id}/usage")
def get_parameter_usage(id: str, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    used_in = db.query(models.ParameterDef).filter(
        models.ParameterDef.implicational_condition.ilike(f"%{id}%")
    ).all()
    return [{"id": p.id, "name": p.name} for p in used_in if p.id != id]

# ==========================================
# ENDPOINT LOOKUPS
# ==========================================

class LookupBase(BaseModel):
    label: str

@router.get("/lookups/schemas")
def get_schemas(db: Session = Depends(get_db)):
    return [{"id": item.id, "label": item.label} for item in db.query(models.ParamSchema).all()]

@router.post("/lookups/schemas")
def create_schema(item: LookupBase, db: Session = Depends(get_db)):
    db_item = models.ParamSchema(label=item.label)
    db.add(db_item)
    try:
        db.commit()
        return {"id": db_item.id, "label": db_item.label}
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Schema già esistente")

@router.get("/lookups/types")
def get_types(db: Session = Depends(get_db)):
    return [{"id": item.id, "label": item.label} for item in db.query(models.ParamType).all()]

@router.post("/lookups/types")
def create_type(item: LookupBase, db: Session = Depends(get_db)):
    db_item = models.ParamType(label=item.label)
    db.add(db_item)
    try:
        db.commit()
        return {"id": db_item.id, "label": db_item.label}
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Tipo già esistente")

@router.get("/lookups/levels")
def get_levels(db: Session = Depends(get_db)):
    return [{"id": item.id, "label": item.label} for item in db.query(models.ParamLevelOfComparison).all()]

@router.post("/lookups/levels")
def create_level(item: LookupBase, db: Session = Depends(get_db)):
    db_item = models.ParamLevelOfComparison(label=item.label)
    db.add(db_item)
    try:
        db.commit()
        return {"id": db_item.id, "label": db_item.label}
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Livello già esistente")