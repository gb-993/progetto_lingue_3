"""Router utente per il flusso di accettazione documenti legali (consents).

Endpoint:

  - GET  /api/consents/required
        Risponde con la lista dei documenti legali correnti che l'utente
        loggato deve ancora accettare. Lista vuota = utente in regola.
        Il frontend chiama questa rotta dopo il login (e all'avvio app
        per chi ha gia' un token) per decidere se mostrare il modal
        bloccante. Tutti i metadati necessari al modal sono nella
        risposta (URL del PDF, clausole vessatorie, version, ecc.).

  - POST /api/consents/accept
        Registra l'accettazione di uno o piu' documenti da parte dell'utente.
        Salva una riga in `consents` per ciascun documento, con IP, user
        agent, timestamp e flag `vexatious_clauses_approved`. Tutto in
        singola transazione.

Permessi: entrambi gli endpoint richiedono solo `get_current_user` (utente
loggato, qualsiasi ruolo). NON usano `require_consented_user` (che vedremo
allo Step 4) altrimenti si creerebbe un blocco circolare: per "accettare"
il consenso bisognerebbe gia' essere in regola.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

import models
from dependencies import get_current_user, get_db
from services.legal_document_service import build_public_url
from time_utils import utc_now


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/consents", tags=["Consents"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _serialize_doc_for_modal(doc: models.LegalDocument) -> dict:
    """Forma JSON di un documento legale per il modal di accettazione utente.

    Include solo i campi che il modal frontend deve effettivamente mostrare/
    referenziare. NON espone sha256 o file_path interno: il modal usa
    solo `public_url` per il link "Open PDF".
    """
    return {
        "id": doc.id,
        "type": doc.type,
        "version": doc.version,
        "public_url": build_public_url(doc.file_path),
        # Lista vessatorie congelata al momento dell'upload (puo' differire
        # da VEXATIOUS_CLAUSES_DEFAULT corrente; e' quella che il modal deve
        # mostrare per QUESTA versione del documento).
        "vexatious_clauses": doc.vexatious_clauses,
        "published_at": doc.published_at.isoformat() if doc.published_at else None,
    }


def _has_vexatious(doc: models.LegalDocument) -> bool:
    """True se il documento ha clausole vessatorie configurate (non-null,
    non-empty). Sopra cui si attiva la seconda checkbox del modal."""
    return bool(doc.vexatious_clauses)


def _user_has_consented_to(db: Session, user_id: int, legal_document_id: int) -> bool:
    """True se l'utente ha gia' una consents row attiva (non revocata)
    per quel documento specifico."""
    return (
        db.query(models.Consent.id)
        .filter(
            models.Consent.user_id == user_id,
            models.Consent.legal_document_id == legal_document_id,
            models.Consent.revoked_at.is_(None),
        )
        .first()
        is not None
    )


def _user_ever_accepted_type(db: Session, user_id: int, doc_type: str) -> bool:
    """True se l'utente ha mai accettato (anche versioni precedenti, anche
    revocate) un documento di questo type. Usato per decidere il valore
    di `method` da scrivere in consents:
      - True  -> "version_update_modal"  (sta accettando una nuova versione)
      - False -> "first_login_modal"      (prima accettazione assoluta)
    """
    return (
        db.query(models.Consent.id)
        .join(models.LegalDocument, models.LegalDocument.id == models.Consent.legal_document_id)
        .filter(
            models.Consent.user_id == user_id,
            models.LegalDocument.type == doc_type,
        )
        .first()
        is not None
    )


# ---------------------------------------------------------------------------
# GET /api/consents/required
# ---------------------------------------------------------------------------
@router.get("/required")
def get_required_consents(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Lista documenti is_current per cui l'utente NON ha consenso attivo.

    Risposta:
      {
        "required": [
          {
            "id": 42,
            "type": "terms_of_use",
            "version": "v1.0",
            "public_url": "https://hub.../legal-docs/Terms_of_use_v1.0_2026-05-18.pdf",
            "vexatious_clauses": ["7", "8", "9.2", "11"],
            "published_at": "2026-05-18T12:00:00Z"
          },
          {
            "id": 17,
            "type": "privacy_notice",
            ...
            "vexatious_clauses": null
          }
        ]
      }

    Lista vuota = utente in regola, nessun modal da mostrare.
    """
    current_docs = (
        db.query(models.LegalDocument)
        .filter(models.LegalDocument.is_current == True)  # noqa: E712
        .all()
    )

    required = [
        _serialize_doc_for_modal(d)
        for d in current_docs
        if not _user_has_consented_to(db, current_user.id, d.id)
    ]
    return {"required": required}


# ---------------------------------------------------------------------------
# POST /api/consents/accept
# ---------------------------------------------------------------------------
class AcceptRequest(BaseModel):
    """Payload del modal di accettazione utente.

    `accepted_document_ids`: id dei legal_documents che l'utente sta
    accettando. Normalmente sono quelli ritornati dal GET /required, ma
    il backend ricontrolla che siano davvero is_current (no race).

    `vexatious_clauses_approved`: True se l'utente ha spuntato la seconda
    checkbox del modal. Obbligatorio (= deve essere True) se almeno uno
    dei documenti accettati ha vexatious_clauses configurate.
    """
    accepted_document_ids: list[int] = Field(min_length=1)
    vexatious_clauses_approved: bool = False


@router.post("/accept", status_code=201)
def accept_consents(
    payload: AcceptRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Registra una accettazione per ciascun documento nel payload.

    Validazioni:
      1) Gli id devono esistere E essere is_current=True. Se l'utente
         tenta di accettare una versione obsoleta (es. ha la pagina aperta
         da prima del deploy di una nuova versione), rispondiamo 409 e
         il frontend deve ricaricare.
      2) Se almeno uno dei documenti ha clausole vessatorie, il flag
         `vexatious_clauses_approved` deve essere True. Difesa server-side
         specchio della validazione frontend.
      3) Se l'utente ha gia' un consenso attivo per uno dei documenti,
         rispondiamo 409 (non duplichiamo le righe).

    Side effect: una INSERT per ogni documento. Tutto in transazione: se
    una insert fallisce, rollback completo.
    """
    # 1) Carica tutti i documenti richiesti in una sola query.
    docs = (
        db.query(models.LegalDocument)
        .filter(models.LegalDocument.id.in_(payload.accepted_document_ids))
        .all()
    )
    found_ids = {d.id for d in docs}
    missing = set(payload.accepted_document_ids) - found_ids
    if missing:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown legal_document id(s): {sorted(missing)}",
        )

    # Tutti devono essere is_current. Se uno e' obsoleto, l'utente sta
    # accettando una versione vecchia -> chiediamo refresh.
    obsolete = [d for d in docs if not d.is_current]
    if obsolete:
        raise HTTPException(
            status_code=409,
            detail=(
                "One or more documents are no longer the current version. "
                "Reload the page to see the latest version."
            ),
        )

    # 2) Vexatious clauses: se ALMENO uno dei doc le ha, il flag deve essere True.
    any_vexatious = any(_has_vexatious(d) for d in docs)
    if any_vexatious and not payload.vexatious_clauses_approved:
        raise HTTPException(
            status_code=400,
            detail=(
                "Specific approval required for vexatious clauses "
                "(art. 1341 c.c.). Please tick the second checkbox."
            ),
        )

    # 3) Idempotenza: se l'utente ha gia' accettato uno di questi documenti
    # (consenso attivo), non duplichiamo.
    for d in docs:
        if _user_has_consented_to(db, current_user.id, d.id):
            raise HTTPException(
                status_code=409,
                detail=f"User has already accepted document id={d.id} ({d.type} {d.version}).",
            )

    # 4) Estrai metadati di contesto (IP, UA) per audit.
    ip_address = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")

    # 5) INSERT in transazione.
    created: list[models.Consent] = []
    try:
        for d in docs:
            # method dipende da se l'utente ha gia' accettato in passato
            # questo type (anche versioni precedenti / revocate).
            ever_accepted = _user_ever_accepted_type(db, current_user.id, d.type)
            method = "version_update_modal" if ever_accepted else "first_login_modal"

            # vexatious_clauses_approved si applica alla singola riga del
            # documento che HA clausole vessatorie: per gli altri (es. Privacy)
            # resta False, anche se l'utente ha spuntato il flag.
            row = models.Consent(
                user_id=current_user.id,
                legal_document_id=d.id,
                accepted_at=utc_now(),
                ip_address=ip_address,
                user_agent=user_agent,
                method=method,
                vexatious_clauses_approved=(
                    payload.vexatious_clauses_approved if _has_vexatious(d) else False
                ),
            )
            db.add(row)
            created.append(row)

        db.commit()
        for row in created:
            db.refresh(row)
    except Exception:
        db.rollback()
        logger.exception(
            "accept_consents: rollback (user_id=%s, docs=%s)",
            current_user.id, [d.id for d in docs],
        )
        raise

    logger.info(
        "Consents accepted: user_id=%s docs=%s vexatious_approved=%s",
        current_user.id,
        [{"id": d.id, "type": d.type, "version": d.version} for d in docs],
        payload.vexatious_clauses_approved,
    )
    return {
        "accepted": [
            {
                "id": row.id,
                "legal_document_id": row.legal_document_id,
                "accepted_at": row.accepted_at.isoformat(),
                "method": row.method,
                "vexatious_clauses_approved": row.vexatious_clauses_approved,
            }
            for row in created
        ]
    }
