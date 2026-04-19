from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import models
from dependencies import get_db, require_admin

router = APIRouter(prefix="/api/admin/parameters", tags=["Parameters"])


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


@router.get("")
def get_admin_parameters(db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    parameters = db.query(models.ParameterDef).order_by(models.ParameterDef.position, models.ParameterDef.id).all()
    return parameters


@router.get("/{id}")
def get_admin_parameter(id: str, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    parameter = db.query(models.ParameterDef).filter(models.ParameterDef.id == id).first()
    if not parameter:
        raise HTTPException(status_code=404, detail="Parametro non trovato")
    return parameter


@router.post("", status_code=status.HTTP_201_CREATED)
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


@router.put("/{id}")
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


@router.delete("/{id}")
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

