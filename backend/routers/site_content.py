from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Dict, List

import models
from dependencies import get_db, require_admin

router = APIRouter(tags=["Site Content"])

# --- SCHEMI PYDANTIC ---
class MapDataResponse(BaseModel):
    id: str
    name: str
    lat: float
    lng: float
    family: str

class SiteContentUpdate(BaseModel):
    content: str

# ==========================================
# ENDPOINT PUBBLICI
# ==========================================

@router.get("/api/public/map-data", response_model=List[MapDataResponse])
def get_map_data(db: Session = Depends(get_db)):
    """
    Recupera tutte le lingue che hanno coordinate geografiche.
    Utilizzato per renderizzare la mappa interattiva nella Public Dashboard.
    """
    langs = db.query(models.Language).filter(
        models.Language.latitude.isnot(None),
        models.Language.longitude.isnot(None)
    ).all()

    result = []
    for l in langs:
        result.append({
            "id": l.id,
            "name": l.name_full,
            "lat": float(l.latitude),
            "lng": float(l.longitude),
            "family": l.top_level_family or 'Unknown'
        })
    return result

@router.get("/api/public/site-content", response_model=Dict[str, str])
def get_site_content(db: Session = Depends(get_db)):
    """
    Recupera tutti i contenuti dinamici del sito (es. regole di citazione).
    Restituisce un dizionario chiave: contenuto per facilitare l'uso in React.
    """
    contents = db.query(models.SiteContent).all()
    return {item.key: item.content for item in contents}

# ==========================================
# ENDPOINT ADMIN
# ==========================================

@router.put("/api/admin/site-content/{key}")
def update_site_content(key: str, data: SiteContentUpdate, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    """
    Aggiorna o crea un blocco di testo dinamico. Riservato agli amministratori.
    """
    content_obj = db.query(models.SiteContent).filter(models.SiteContent.key == key).first()

    if not content_obj:
        # Se la chiave non esiste, la crea
        content_obj = models.SiteContent(
            key=key,
            page="how_to_cite",  # Default page logico
            content=data.content,
            updated_by_id=current_user.id
        )
        db.add(content_obj)
    else:
        # Altrimenti aggiorna quella esistente
        content_obj.content = data.content
        content_obj.updated_by_id = current_user.id

    db.commit()
    return {"detail": f"Contenuto '{key}' aggiornato con successo."}