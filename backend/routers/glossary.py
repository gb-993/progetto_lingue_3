from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import models
from dependencies import get_db, require_admin

# Router per Admin (CRUD completo)
router = APIRouter(prefix="/api/admin/glossary", tags=["Glossary"])

# Router per Utenti / Pubblico (Solo lettura)
public_router = APIRouter(prefix="/api/glossary", tags=["Glossary Public"])

class GlossaryBase(BaseModel):
    word: str
    description: str


# ==========================================
# ENDPOINT UTENTI (Sola lettura)
# ==========================================
@public_router.get("")
def get_public_glossary(db: Session = Depends(get_db)):
    glossary_items = db.query(models.Glossary).order_by(models.Glossary.word).all()
    return glossary_items


# ==========================================
# ENDPOINT ADMIN
# ==========================================
@router.get("")
def get_admin_glossary(db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    glossary_items = db.query(models.Glossary).order_by(models.Glossary.word).all()
    return glossary_items


@router.get("/{id}")
def get_glossary_term(id: int, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    item = db.query(models.Glossary).filter(models.Glossary.id == id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Termine non trovato")
    return item


@router.post("", status_code=status.HTTP_201_CREATED)
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


@router.put("/{id}")
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


@router.delete("/{id}")
def delete_glossary_term(id: int, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    db_item = db.query(models.Glossary).filter(models.Glossary.id == id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Termine non trovato")

    db.delete(db_item)
    db.commit()
    return {"detail": "Termine eliminato con successo"}