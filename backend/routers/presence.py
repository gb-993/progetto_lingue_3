"""
Presence effimera per l'avviso di modifica concorrente.

Quando un utente apre un form di modifica, il client batte un heartbeat ogni
~8s. L'endpoint /heartbeat aggiorna la riga (entity_type, entity_id, user_id)
e risponde con il numero di ALTRI utenti attivi sulla stessa entita'. Il
frontend mostra un banner anonimo ("un altro utente sta modificando"): qui non
viene mai restituita l'identita' di nessuno, solo un conteggio.

Privacy: dati effimeri (TTL di pochi decine di secondi), nessuno storico. Le
righe scadute vengono cancellate a ogni heartbeat. Vedi models.EditingSession.
"""
import logging
from datetime import timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel, field_validator
from sqlalchemy import func
from sqlalchemy.orm import Session

import models
from time_utils import utc_now
from dependencies import get_db, get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/presence", tags=["Presence"])

# Un utente e' "attivo" su un'entita' se ha battuto un heartbeat negli ultimi
# TTL secondi. Il client batte ogni ~8s (HEARTBEAT_MS in usePresence.js): 25s
# lascia ~17s di margine, cioe' tollera DUE battiti persi senza falsi "uscito".
# Margine generoso voluto: gli utenti si connettono via VPN e su WiFi
# universitario, dove latenza e battiti irregolari sono frequenti.
PRESENCE_TTL_SECONDS = 25

# Allowlist dei tipi tracciabili (evita di accettare stringhe arbitrarie).
#   - "question" / "parameter": form di modifica admin (scheda question/parametro).
#   - "language_parameter": sezione Data della compilazione, scopo per
#     (lingua, parametro). entity_id = "<langId>:<paramId>" (max 10+1+10 = 21,
#     entro il limite di 40 del validator sotto). Avverte quando due persone
#     stanno compilando lo STESSO parametro della STESSA lingua.
_ALLOWED_ENTITY_TYPES = {"question", "parameter", "language_parameter"}


class PresencePayload(BaseModel):
    entity_type: str
    entity_id: str

    @field_validator("entity_type")
    @classmethod
    def _valid_type(cls, v):
        v = (v or "").strip()
        if v not in _ALLOWED_ENTITY_TYPES:
            raise ValueError("Unsupported entity_type")
        return v

    @field_validator("entity_id")
    @classmethod
    def _valid_id(cls, v):
        v = (v or "").strip()
        if not v or len(v) > 40:
            raise ValueError("Invalid entity_id")
        return v


@router.post("/heartbeat")
def heartbeat(
    payload: PresencePayload,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Aggiorna/crea la presence dell'utente e ritorna quanti ALTRI utenti sono
    attivi sulla stessa entita' (solo conteggio, mai identita')."""
    now = utc_now()
    cutoff = now - timedelta(seconds=PRESENCE_TTL_SECONDS)

    row = db.query(models.EditingSession).filter(
        models.EditingSession.entity_type == payload.entity_type,
        models.EditingSession.entity_id == payload.entity_id,
        models.EditingSession.user_id == current_user.id,
    ).first()
    if row:
        row.last_heartbeat = now
    else:
        db.add(models.EditingSession(
            entity_type=payload.entity_type,
            entity_id=payload.entity_id,
            user_id=current_user.id,
            last_heartbeat=now,
        ))

    # Pulizia delle righe scadute per questa entita': niente storico.
    db.query(models.EditingSession).filter(
        models.EditingSession.entity_type == payload.entity_type,
        models.EditingSession.entity_id == payload.entity_id,
        models.EditingSession.last_heartbeat < cutoff,
    ).delete(synchronize_session=False)

    db.commit()

    others = db.query(func.count(func.distinct(models.EditingSession.user_id))).filter(
        models.EditingSession.entity_type == payload.entity_type,
        models.EditingSession.entity_id == payload.entity_id,
        models.EditingSession.user_id != current_user.id,
        models.EditingSession.last_heartbeat >= cutoff,
    ).scalar() or 0

    return {"others": int(others)}


@router.post("/leave")
def leave(
    payload: PresencePayload,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Rimuove subito la presence dell'utente (best-effort all'uscita dal form).
    Se non viene chiamata, la riga scade comunque per TTL."""
    db.query(models.EditingSession).filter(
        models.EditingSession.entity_type == payload.entity_type,
        models.EditingSession.entity_id == payload.entity_id,
        models.EditingSession.user_id == current_user.id,
    ).delete(synchronize_session=False)
    db.commit()
    return {"ok": True}
