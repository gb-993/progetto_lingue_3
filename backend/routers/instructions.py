from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
import models
from dependencies import get_db, require_admin, get_current_user
from datetime import datetime

router = APIRouter(prefix="/api/content", tags=["Content"])

class ContentUpdate(BaseModel):
    content: str

@router.get("/{key}")
def get_site_content(key: str, db: Session = Depends(get_db)):
    """Recupera un contenuto per chiave (es: instr_body)"""
    item = db.query(models.SiteContent).filter(models.SiteContent.key == key).first()
    if not item:
        # Se non esiste, restituiamo un default vuoto o errore gestito dal front
        return {"key": key, "content": ""}
    return item

@router.put("/{key}")
def update_site_content(
        key: str,
        data: ContentUpdate,
        db: Session = Depends(get_db),
        current_user: models.User = Depends(require_admin)
):
    """Aggiorna il contenuto (Solo Admin)"""
    item = db.query(models.SiteContent).filter(models.SiteContent.key == key).first()

    if not item:
        item = models.SiteContent(key=key, page="Instructions")
        db.add(item)

    item.content = data.content
    item.updated_by_id = current_user.id
    item.updated_at = datetime.utcnow()

    db.commit()
    return {"detail": "Content updated successfully."}