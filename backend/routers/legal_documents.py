"""Router per la gestione dei documenti legali.

Espone due router:

* `router` (prefix `/api/admin/legal-documents`): operazioni di gestione
  riservate agli admin (lista versioni, preview, pubblicazione di una nuova
  versione).
* `public_router` (prefix `/api/legal-documents`): endpoint pubblici (no
  auth) che permettono al frontend — anche a visitatori non loggati — di
  scoprire l'URL della versione corrente di ciascun documento. Usato dal
  footer del sito per linkare sempre l'ultima versione pubblicata invece
  di un PDF statico in `frontend/public/docs/`.

Endpoint admin:

  - GET  /api/admin/legal-documents
        Lista TUTTE le versioni di TUTTI i documenti (current + storiche),
        ordinate per type e poi per `published_at` desc. Usato dalla pagina
        admin per mostrare la tabella "Legal Documents".

  - POST /api/admin/legal-documents/preview
        Riceve un PDF (multipart/form-data), estrae automaticamente type
        e version dal contenuto, calcola sha256, ritorna il riepilogo dei
        metadati. NON salva nulla. Usato dal frontend per mostrare la
        schermata di conferma prima dell'upload effettivo.

  - POST /api/admin/legal-documents
        Riceve un PDF + (opzionale) una nota. Estrae i metadati, salva il
        file su filesystem (LEGAL_DOCUMENTS_DIR), inserisce la riga in DB
        con is_current=True, scolora la precedente versione corrente.

Endpoint pubblici:

  - GET /api/legal-documents/current
        Mappa `{type: {version, public_url, published_at}}` con le versioni
        correnti di tutti i documenti legali. Niente auth: il footer del
        sito lo chiama anche da pagine pubbliche.

Permessi: gli endpoint admin richiedono `require_admin`. La pubblicazione
e' delicata ma deve restare accessibile a tutti gli admin (la sidebar e
la UI sono coerenti). Gli endpoint pubblici non richiedono auth e sono
whitelistati nel consent enforcement middleware.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from sqlalchemy.orm import Session

import models
from dependencies import get_db, require_admin
from services.legal_document_service import (
    build_public_url,
    extract_metadata,
    publish_new_version,
)


logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/admin/legal-documents",
    tags=["LegalDocuments"],
)

# Router pubblico: niente auth, niente consent enforcement. Usato dal
# footer del frontend (anche per visitatori sloggati) per ottenere l'URL
# del PDF corrente di Terms of Use / Privacy Notice. Vedi whitelist in
# consent_enforcement.CONSENT_BYPASS_PREFIXES.
public_router = APIRouter(
    prefix="/api/legal-documents",
    tags=["LegalDocuments"],
)


# ---------------------------------------------------------------------------
# Serializers
# ---------------------------------------------------------------------------
def _serialize(doc: models.LegalDocument) -> dict:
    """Forma JSON di una riga di legal_documents per l'admin UI.

    Espone l'URL pubblico (utile per scaricare il file) e i metadati
    completi inclusa la lista vessatorie e la nota.
    """
    return {
        "id": doc.id,
        "type": doc.type,
        "version": doc.version,
        "file_path": doc.file_path,
        "public_url": build_public_url(doc.file_path),
        "sha256": doc.sha256,
        "published_at": doc.published_at.isoformat() if doc.published_at else None,
        "is_current": doc.is_current,
        "vexatious_clauses": doc.vexatious_clauses,
        "note": doc.note,
    }


# ---------------------------------------------------------------------------
# GET /api/admin/legal-documents
# ---------------------------------------------------------------------------
@router.get("")
def list_all(
    db: Session = Depends(get_db),
    _admin: models.User = Depends(require_admin),
):
    """Lista completa di tutte le versioni di tutti i documenti.

    Ordinamento: prima per type (alfabetico, raggruppa ToU/Privacy), poi
    per published_at desc (la corrente in cima, le storiche sotto).
    """
    docs = (
        db.query(models.LegalDocument)
        .order_by(
            models.LegalDocument.type.asc(),
            models.LegalDocument.published_at.desc(),
        )
        .all()
    )
    return [_serialize(d) for d in docs]


# ---------------------------------------------------------------------------
# POST /api/admin/legal-documents/preview
# ---------------------------------------------------------------------------
@router.post("/preview")
async def preview_upload(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _admin: models.User = Depends(require_admin),
):
    """Estrae i metadati dal PDF e mostra il riepilogo prima del salvataggio.

    Niente filesystem, niente DB write: solo lettura del file in memoria,
    parsing e check duplicati.

    Risposta:
      {
        "type": "terms_of_use",
        "version": "v1.0",
        "sha256": "...",
        "size_bytes": 12345,
        "vexatious_clauses": ["7", "8", "9.2", "11"],
        "would_replace": {"version": "v0.9", "published_at": "..."} | null,
        "already_exists": false
      }
    """
    pdf_bytes = await file.read()
    metadata = extract_metadata(pdf_bytes)

    # Avvisa l'UI se la (type, version) e' gia' presente: cosi' il frontend
    # puo' mostrare un errore inline e disabilitare il bottone Confirm.
    already = (
        db.query(models.LegalDocument)
        .filter(
            models.LegalDocument.type == metadata.type,
            models.LegalDocument.version == metadata.version,
        )
        .first()
    )

    # Avvisa quale versione corrente verrebbe scolorata (UX: l'admin vede
    # che sta sostituendo la v0.9 con la v1.0).
    current = (
        db.query(models.LegalDocument)
        .filter(
            models.LegalDocument.type == metadata.type,
            models.LegalDocument.is_current == True,  # noqa: E712
        )
        .first()
    )

    return {
        "type": metadata.type,
        "version": metadata.version,
        "sha256": metadata.sha256,
        "size_bytes": metadata.size_bytes,
        "vexatious_clauses": metadata.vexatious_clauses,
        "would_replace": (
            {
                "id": current.id,
                "version": current.version,
                "published_at": current.published_at.isoformat() if current.published_at else None,
            } if current else None
        ),
        "already_exists": bool(already),
    }


# ---------------------------------------------------------------------------
# POST /api/admin/legal-documents
# ---------------------------------------------------------------------------
@router.post("", status_code=201)
async def publish(
    request: Request,
    file: UploadFile = File(...),
    note: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    """Pubblica una nuova versione di documento legale.

    Sequenza:
      1) Estrai metadati dal PDF (riusa preview).
      2) Scrivi il file su filesystem.
      3) Inserisci riga in DB con is_current=True + scolora la precedente.
      4) Registra auto-accettazione del publisher (vedi razionale nel
         service): senza, il middleware consent_enforcement bloccherebbe
         immediatamente l'admin appena pubblicato chiedendogli di
         accettare cio' che ha appena caricato.

    Risposta: la riga creata, serializzata come da `_serialize`.
    """
    if note is not None and len(note) > 1000:
        raise HTTPException(
            status_code=400,
            detail="Note too long (max 1000 characters).",
        )

    pdf_bytes = await file.read()
    metadata = extract_metadata(pdf_bytes)

    new_doc = publish_new_version(
        db=db,
        metadata=metadata,
        pdf_bytes=pdf_bytes,
        note=note,
        publisher_user_id=admin.id,
        publisher_ip=request.client.host if request.client else None,
        publisher_user_agent=request.headers.get("user-agent"),
    )
    return _serialize(new_doc)


# ---------------------------------------------------------------------------
# GET /api/legal-documents/current  (PUBLIC, no auth)
# ---------------------------------------------------------------------------
@public_router.get("/current")
def get_current_documents(db: Session = Depends(get_db)):
    """Versioni correnti di tutti i documenti legali — endpoint pubblico.

    Niente auth: il footer del sito (anche per visitatori non loggati)
    chiama questa rotta all'avvio per scoprire l'URL del PDF da linkare.
    Cosi' i link "Privacy Policy" / "Disclaimer" puntano sempre all'ultima
    versione caricata via UI admin, non a un PDF statico hardcoded.

    Risposta:
      {
        "terms_of_use": {
          "version": "v1.0",
          "public_url": "https://hub.../legal-docs/Terms_of_use_v1.0_...pdf",
          "published_at": "2026-05-18T12:00:00Z"
        },
        "privacy_notice": { ... }
      }

    Se per un type non c'e' nessun documento current (es. al primo deploy
    prima del primo upload), la chiave manca dalla risposta. Il footer deve
    gestire l'assenza con un fallback (es. nascondere il link).
    """
    docs = (
        db.query(models.LegalDocument)
        .filter(models.LegalDocument.is_current == True)  # noqa: E712
        .all()
    )
    return {
        d.type: {
            "version": d.version,
            "public_url": build_public_url(d.file_path),
            "published_at": d.published_at.isoformat() if d.published_at else None,
        }
        for d in docs
    }
