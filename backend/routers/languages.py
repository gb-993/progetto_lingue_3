from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import models
from dependencies import get_db, require_admin

router = APIRouter(prefix="/api", tags=["Languages"])


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


@router.get("/public/languages")
def get_public_languages(db: Session = Depends(get_db)):
    langs = db.query(models.Language).all()
    return [
        {
            "id": l.id,
            "name": l.name_full,
            "lat": float(l.latitude) if l.latitude else None,
            "lng": float(l.longitude) if l.longitude else None,
            "family": l.top_level_family,
        }
        for l in langs
    ]


@router.get("/admin/languages")
def get_admin_languages(db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    languages = db.query(models.Language).order_by(models.Language.position, models.Language.name_full).all()
    return languages


@router.get("/admin/languages/{id}")
def get_admin_language(id: str, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    language = db.query(models.Language).filter(models.Language.id == id).first()
    if not language:
        raise HTTPException(status_code=404, detail="Lingua non trovata")
    return language


@router.post("/admin/languages", status_code=status.HTTP_201_CREATED)
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


@router.put("/admin/languages/{id}")
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


@router.delete("/admin/languages/{id}")
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

