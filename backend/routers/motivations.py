from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import models
from dependencies import get_db, require_admin

router = APIRouter(prefix="/api/admin/motivations", tags=["Motivations"])

# --- SCHEMA PYDANTIC ---
class MotivationBase(BaseModel):
    code: str
    label: str
    is_active: bool = True

class MotivationRead(MotivationBase):
    id: int

    class Config:
        from_attributes = True

# --- ENDPOINT ---
@router.get("", response_model=List[MotivationRead])
def get_motivations(include_inactive: bool = False, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    """Recupera la lista delle motivazioni. Se include_inactive=True, prende anche quelle disattivate."""
    query = db.query(models.Motivation)
    if not include_inactive:
        query = query.filter(models.Motivation.is_active == True)
    return query.order_by(models.Motivation.code).all()

@router.post("", response_model=MotivationRead, status_code=status.HTTP_201_CREATED)
def create_motivation(item: MotivationBase, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    """Crea una nuova motivazione (usata sia in pagina che 'on the fly' nel creatable select)"""
    db_item = models.Motivation(
        code=item.code,
        label=item.label,
        is_active=item.is_active
    )
    db.add(db_item)
    try:
        db.commit()
        db.refresh(db_item)
        return db_item
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Impossibile creare la motivazione. Verifica i dati inseriti.")

@router.put("/{id}", response_model=MotivationRead)
def update_motivation(id: int, item: MotivationBase, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    """Aggiorna testo o disattiva una motivazione"""
    db_item = db.query(models.Motivation).filter(models.Motivation.id == id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Motivazione non trovata")

    db_item.code = item.code
    db_item.label = item.label
    db_item.is_active = item.is_active

    try:
        db.commit()
        db.refresh(db_item)
        return db_item
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Impossibile aggiornare la motivazione.")

@router.delete("/{id}")
def delete_motivation(id: int, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    db_item = db.query(models.Motivation).filter(models.Motivation.id == id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Motivazione non trovata")

    db.delete(db_item)
    try:
        db.commit()
        return {"detail": "Motivazione eliminata con successo"}
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Impossibile eliminare: la motivazione è già utilizzata in alcune risposte o domande. Prova a disattivarla invece di eliminarla.")