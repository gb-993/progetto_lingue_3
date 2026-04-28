from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import models
from dependencies import get_db, require_admin, get_current_user
from services.versioning import record_version

router = APIRouter(prefix="/api", tags=["Languages"])


class LanguageBase(BaseModel):
    id: str
    name_full: str
    position: int
    family: str = ""
    top_level_family: str = ""
    grp: str = ""
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    historical_language: bool = False
    assigned_user_id: Optional[int] = None
    # Campi metadata aggiuntivi
    isocode: str = ""
    glottocode: str = ""
    informant: str = ""
    supervisor: str = ""
    source: str = ""
    location: str = ""


def validate_coordinates(latitude: Optional[float], longitude: Optional[float]):
    if latitude is not None and not -90 <= latitude <= 90:
        raise HTTPException(status_code=422, detail="Latitude must be between -90 and 90")
    if longitude is not None and not -180 <= longitude <= 180:
        raise HTTPException(status_code=422, detail="Longitude must be between -180 and 180")


def ensure_assigned_user_exists(user_id: Optional[int], db: Session):
    if user_id is None:
        return
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Assigned user not found")


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
def get_admin_languages(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    """
    Restituisce le lingue.
    Se Admin: tutte.
    Se User: solo quelle assegnate.
    """
    query = db.query(models.Language)

    if current_user.role != "admin":
        query = query.filter(models.Language.assigned_user_id == current_user.id)

    languages = query.order_by(models.Language.position, models.Language.name_full).all()
    return [{
        "id": l.id,
        "name_full": l.name_full,
        "position": l.position,
        "family": l.family,
        "top_level_family": l.top_level_family,
        "grp": l.grp,
        "latitude": float(l.latitude) if l.latitude is not None else None,
        "longitude": float(l.longitude) if l.longitude is not None else None,
        "historical_language": l.historical_language,
        "assigned_user_id": l.assigned_user_id,
        "isocode": l.isocode or "",
        "glottocode": l.glottocode or "",
        "informant": l.informant or "",
        "supervisor": l.supervisor or "",
        "source": l.source or "",
        "location": l.location or "",
        "status": l.status,
        "rejection_note": l.rejection_note,
        "submitted_at": l.submitted_at.isoformat() if l.submitted_at else None,
        "reviewed_at": l.reviewed_at.isoformat() if l.reviewed_at else None,
    } for l in languages]


@router.get("/admin/languages/{id}")
def get_admin_language(id: str, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    """
    Recupera una singola lingua con controllo permessi.
    """
    language = db.query(models.Language).filter(models.Language.id == id).first()
    if not language:
        raise HTTPException(status_code=404, detail="Language not found")

    # Se non è admin, deve essere l'assegnatario
    if current_user.role != "admin" and language.assigned_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied to this language.")

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
        grp=item.grp,
        latitude=item.latitude,
        longitude=item.longitude,
        historical_language=item.historical_language,
        assigned_user_id=item.assigned_user_id,
        isocode=item.isocode,
        glottocode=item.glottocode,
        informant=item.informant,
        supervisor=item.supervisor,
        source=item.source,
        location=item.location,
    )
    db.add(db_item)
    try:
        db.commit()
        db.refresh(db_item)
        record_version(db, db_item, operation="create", source="manual", user_id=current_user.id)
        db.commit()
        return db_item
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Could not create the language (duplicate ID or invalid data).")


@router.put("/admin/languages/{id}")
def update_admin_language(id: str, item: LanguageBase, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    db_item = db.query(models.Language).filter(models.Language.id == id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Language not found")

    validate_coordinates(item.latitude, item.longitude)
    ensure_assigned_user_exists(item.assigned_user_id, db)

    db_item.id = item.id
    db_item.name_full = item.name_full
    db_item.position = item.position
    db_item.family = item.family
    db_item.top_level_family = item.top_level_family
    db_item.grp = item.grp
    db_item.latitude = item.latitude
    db_item.longitude = item.longitude
    db_item.historical_language = item.historical_language
    db_item.assigned_user_id = item.assigned_user_id
    db_item.isocode = item.isocode
    db_item.glottocode = item.glottocode
    db_item.informant = item.informant
    db_item.supervisor = item.supervisor
    db_item.source = item.source
    db_item.location = item.location

    try:
        db.commit()
        db.refresh(db_item)
        record_version(db, db_item, operation="update", source="manual", user_id=current_user.id)
        db.commit()
        return db_item
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Could not update the language (duplicate ID or invalid data).")


@router.get("/api/admin/languages/{id}")
def delete_admin_language(id: str, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    db_item = db.query(models.Language).filter(models.Language.id == id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Language not found")

    db.delete(db_item)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Could not delete the language: related records exist")
    return {"detail": "Language deleted successfully"}