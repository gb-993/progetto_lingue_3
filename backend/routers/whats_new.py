"""
"What's New": annuncio facoltativo (aggiornamenti/novita') mostrato una volta
agli utenti loggati tramite un modale non bloccante.

Design volutamente minimale e a basso rischio:
  - il CONTENUTO (HTML) e' salvato in `site_contents` con chiave `whats_new`,
    la stessa tabella usata da Instructions. `updated_at` (onupdate) fa da
    "versione": ogni salvataggio del super-admin lo aggiorna.
  - lo stato "gia' visto" e' tracciato lato server, per-utente, nella tabella
    `whats_new_views` (vedi models.WhatsNewView): per ogni utente salviamo
    l'updated_at dell'ultima versione su cui ha cliccato "OK". Il backend
    calcola `should_show` confrontando la versione corrente con quella vista.
    Cosi' il banner si vede "una volta" per utente su QUALSIASI dispositivo
    (il vecchio tracciamento in localStorage era invece per-browser).
    Tabella separata da `users` -> nessun rischio di rompere login/`/api/me`.

Permessi: la modifica del contenuto e' riservata al super-admin (come
Migration Import / Backup Restore); la lettura e' per qualsiasi utente loggato.
"""
import re

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

import models
from dependencies import get_db, get_current_user, require_super_admin
from time_utils import utc_now

router = APIRouter(tags=["What's New"])

WHATS_NEW_KEY = "whats_new"

# Toglie i tag HTML e i &nbsp; per capire se resta testo reale. Specchio
# lato server di hasRealText() nel frontend (WhatsNewModal.jsx): una casella
# svuotata (vuota o con solo <p></p>/&nbsp;) NON e' una novita' e non va
# mostrata a nessuno, ritardatari inclusi.
_TAG_RE = re.compile(r"<[^>]*>")
_NBSP_RE = re.compile(r"&nbsp;", re.IGNORECASE)


def _has_real_text(html: str) -> bool:
    if not html:
        return False
    stripped = _NBSP_RE.sub(" ", _TAG_RE.sub("", html))
    return len(stripped.strip()) > 0


class WhatsNewUpdate(BaseModel):
    content: str


def _get_row(db: Session):
    return (
        db.query(models.SiteContent)
        .filter(models.SiteContent.key == WHATS_NEW_KEY)
        .first()
    )


def _user_should_see(db: Session, user_id: int, updated_at) -> bool:
    """True se l'utente NON ha ancora visto la versione corrente.

    Confronta `updated_at` (versione corrente) con `seen_version` salvato per
    l'utente. Nessuna riga = mai visto -> True. seen_version >= updated_at =
    gia' visto questa versione (o piu' recente) -> False.
    NB: il controllo "il contenuto ha testo reale" resta lato frontend
    (hasRealText), che sa togliere tag/&nbsp; vuoti.
    """
    if updated_at is None:
        return False
    view = (
        db.query(models.WhatsNewView)
        .filter(models.WhatsNewView.user_id == user_id)
        .first()
    )
    if view and view.seen_version is not None and view.seen_version >= updated_at:
        return False
    return True


@router.get("/api/whats-new")
def get_whats_new(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Contenuto corrente + updated_at ('versione') + should_show per l'utente.

    should_show e' vero solo se il contenuto ha testo reale E l'utente non ha
    ancora visto la versione corrente. Cosi' svuotare la casella (regola #2) o
    cancellare il contenuto per i ritardatari (regola #3) non mostra nulla a
    nessuno, indipendentemente dalla versione.
    """
    row = _get_row(db)
    if not row:
        return {"content": "", "updated_at": None, "should_show": False}
    content = row.content or ""
    should_show = (
        _has_real_text(content)
        and _user_should_see(db, current_user.id, row.updated_at)
    )
    return {
        "content": content,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        "should_show": should_show,
    }


@router.post("/api/whats-new/seen")
def mark_whats_new_seen(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Segna la versione corrente come vista dall'utente (chiamato su "OK").

    Upsert su whats_new_views: aggiorna seen_version all'updated_at corrente.
    Se non c'e' contenuto/updated_at non c'e' niente da segnare (no-op)."""
    row = _get_row(db)
    if not row or row.updated_at is None:
        return {"detail": "Nothing to mark."}
    now = utc_now()
    view = (
        db.query(models.WhatsNewView)
        .filter(models.WhatsNewView.user_id == current_user.id)
        .first()
    )
    if view:
        view.seen_version = row.updated_at
        view.seen_at = now
    else:
        view = models.WhatsNewView(
            user_id=current_user.id,
            seen_version=row.updated_at,
            seen_at=now,
        )
        db.add(view)
    db.commit()
    return {"detail": "Marked as seen."}


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
