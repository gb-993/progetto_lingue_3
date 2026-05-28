"""
"What's New": annuncio facoltativo (aggiornamenti/novita') mostrato una volta
agli utenti loggati tramite un modale non bloccante.

Design volutamente minimale e a basso rischio:
  - il CONTENUTO (HTML) e' salvato in `site_contents` con chiave `whats_new`,
    la stessa tabella usata da Instructions. `updated_at` (onupdate) fa da
    "versione": ogni salvataggio del super-admin lo aggiorna.
  - lo stato "gia' visto" NON e' nel DB: e' tracciato lato client in
    localStorage (per-dispositivo). Confronto frontend tra l'updated_at
    corrente e l'ultimo visto. Cosi' niente colonne/migration sugli utenti
    e nessun rischio di rompere login/`/api/me`.

Permessi: la modifica del contenuto e' riservata al super-admin (come
Migration Import / Backup Restore); la lettura e' per qualsiasi utente loggato.
"""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

import models
from dependencies import get_db, get_current_user, require_super_admin
from time_utils import utc_now

router = APIRouter(tags=["What's New"])

WHATS_NEW_KEY = "whats_new"


class WhatsNewUpdate(BaseModel):
    content: str


def _get_row(db: Session):
    return (
        db.query(models.SiteContent)
        .filter(models.SiteContent.key == WHATS_NEW_KEY)
        .first()
    )


@router.get("/api/whats-new")
def get_whats_new(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Contenuto corrente + updated_at (usato dal frontend come 'versione')."""
    row = _get_row(db)
    if not row:
        return {"content": "", "updated_at": None}
    return {
        "content": row.content or "",
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


@router.put("/api/admin/whats-new")
def update_whats_new(
    data: WhatsNewUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_super_admin),
):
    """Salva il contenuto (super-admin). Salvare = ripubblicare: forziamo
    l'aggiornamento di updated_at cosi' tutti gli utenti rivedono il modale
    una volta al prossimo accesso."""
    row = _get_row(db)
    now = utc_now()
    if not row:
        row = models.SiteContent(
            key=WHATS_NEW_KEY,
            page="whats_new",
            content=data.content,
            updated_by_id=current_user.id,
        )
        db.add(row)
    else:
        row.content = data.content
        row.updated_by_id = current_user.id
        # Bump esplicito: garantisce la "ripubblicazione" anche se il testo
        # non cambia (onupdate non scatterebbe senza modifiche ai campi).
        row.updated_at = now
    db.commit()
    return {"detail": "What's New updated."}
