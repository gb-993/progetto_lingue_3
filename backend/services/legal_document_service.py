"""Servizio di gestione documenti legali (Terms of Use, Privacy Notice).

Espone tre operazioni principali, usate dal router admin
(`routers/legal_documents.py`):

1. `extract_metadata(pdf_bytes)`: dato il contenuto binario di un PDF appena
   caricato, estrae automaticamente type ("terms_of_use" / "privacy_notice")
   e version ("v1.0", "v1.1", ...). Tira anche fuori lo sha256 del file e
   la lista delle clausole vessatorie applicate (snapshot della config).
   NON tocca DB ne' filesystem: usato per la fase "preview" prima di
   confermare l'upload.

2. `validate_pdf(pdf_bytes)`: validazione bassa (magic header, size limit).
   Solleva HTTPException con messaggio chiaro se qualcosa non torna.

3. `publish_new_version(db, metadata, pdf_bytes)`: dato un metadata
   gia' estratto e validato, scrive il file sotto LEGAL_DOCUMENTS_DIR,
   inserisce la riga in `legal_documents` con `is_current=True` e
   contestualmente mette `is_current=False` sulla versione precedente
   dello stesso type. Tutto in singola transazione SQLAlchemy: se una
   delle due operazioni fallisce, niente viene committato.

L'estrazione del type si basa sul titolo del PDF (prime righe). L'estrazione
della version si basa su un pattern testuale ("version X.Y") che il DPO
deve garantire nei PDF futuri.

Vedi PRIVACY_TODO_DPO.md per la convenzione di naming/versioning dei PDF.
"""
from __future__ import annotations

import hashlib
import io
import logging
import os
import re
from dataclasses import dataclass
from typing import Optional

from fastapi import HTTPException
from pypdf import PdfReader
from sqlalchemy.orm import Session

import models
from config import (
    LEGAL_DOCUMENTS_DIR,
    LEGAL_DOCUMENTS_URL_PREFIX,
    SITE_URL,
    VEXATIOUS_CLAUSES_DEFAULT,
)
from time_utils import utc_now


logger = logging.getLogger(__name__)


# Limite dimensione PDF caricato. I documenti legali sono piccoli (i tuoi
# attuali sono ~200KB). 10MB e' un margine abbondante che blocca upload
# evidentemente sbagliati (file pesanti, immagini, eseguibili rinominati).
MAX_PDF_SIZE = 10 * 1024 * 1024

# Prime righe del PDF su cui cerchiamo il titolo per riconoscere il type.
# Limita lo scan a contenuto utile (titolo) e protegge da PDF molto lunghi.
TYPE_DETECTION_CHARS = 2000

# Pattern delle stringhe-titolo che identificano i due tipi di documento.
# Match case-insensitive. La lista dei sinonimi e' generosa per essere
# robusta a piccole modifiche del DPO sul testo del titolo.
_TYPE_PATTERNS: list[tuple[str, list[str]]] = [
    ("terms_of_use", [
        "TERMS OF USE AND DATA CONTRIBUTOR LICENSE AGREEMENT",
        "TERMS OF USE",
    ]),
    ("privacy_notice", [
        "INFORMATIVA AI SENSI DEGLI ARTT. 13",
        "INFORMATIVA RELATIVA AL TRATTAMENTO DEI DATI PERSONALI",
        "INFORMATIVA",
        "PRIVACY POLICY",
        "PRIVACY NOTICE",
    ]),
]

# Pattern per estrarre la versione dal testo del PDF. Cerca "version X.Y"
# (case-insensitive). I tuoi PDF attuali la ripetono in header/footer di
# ogni pagina nel formato "version 1.0, May 18 2026".
_VERSION_RE = re.compile(r"version\s+(\d+\.\d+)", re.IGNORECASE)


@dataclass(frozen=True)
class ExtractedMetadata:
    """Tutto cio' che il backend riesce a dedurre da un PDF caricato.

    Usato sia dalla fase "preview" (mostrato all'admin per conferma) che
    dalla fase "publish" (passato a publish_new_version per salvare).
    """
    type: str                       # "terms_of_use" | "privacy_notice"
    version: str                    # "v1.0", "v1.1", ...
    sha256: str                     # 64 char hex
    size_bytes: int
    vexatious_clauses: Optional[list[str]]  # snapshot dalla config, None se documento senza


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
def validate_pdf(pdf_bytes: bytes) -> None:
    """Validazione bassa di un PDF caricato.

    Solleva HTTPException con detail chiaro se: vuoto, troppo grande,
    magic header non PDF. Non controlla la struttura interna (lo fa
    pypdf in fase di parsing).
    """
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(pdf_bytes) > MAX_PDF_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File too large ({len(pdf_bytes)} bytes > {MAX_PDF_SIZE} bytes max).",
        )
    # Magic header di PDF: ogni PDF valido inizia con "%PDF-".
    if not pdf_bytes.startswith(b"%PDF-"):
        raise HTTPException(
            status_code=400,
            detail="File does not look like a PDF (missing %PDF- header).",
        )


# ---------------------------------------------------------------------------
# Extraction
# ---------------------------------------------------------------------------
def _read_pdf_text(pdf_bytes: bytes, max_chars: Optional[int] = None) -> str:
    """Concatena il testo di tutte le pagine del PDF. Se `max_chars` e'
    valorizzato, ritorna al massimo quel numero di caratteri.

    Pypdf in caso di PDF malformati solleva: traduciamo in 400 con
    messaggio chiaro per l'admin (di solito significa "non e' un PDF
    valido" oppure "PDF cifrato/protetto").
    """
    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Unable to parse the PDF: {e}",
        )

    parts: list[str] = []
    total = 0
    for page in reader.pages:
        try:
            t = page.extract_text() or ""
        except Exception:
            # Una singola pagina problematica non deve invalidare l'intero
            # estratto: andiamo avanti. Il titolo e la versione tipicamente
            # sono in prima pagina.
            t = ""
        parts.append(t)
        total += len(t)
        if max_chars is not None and total >= max_chars:
            break

    text = "\n".join(parts)
    if max_chars is not None:
        text = text[:max_chars]
    return text


def _detect_type(text: str) -> Optional[str]:
    """Trova il type del documento cercando nel titolo. Ritorna None se
    nessun pattern matcha (caller decide cosa fare)."""
    head = text[:TYPE_DETECTION_CHARS].upper()
    for type_value, patterns in _TYPE_PATTERNS:
        for p in patterns:
            if p.upper() in head:
                return type_value
    return None


def _detect_version(text: str) -> Optional[str]:
    """Estrae la versione (es. "v1.0") dal testo. Convenzione richiesta:
    nel PDF deve apparire la stringa "version X.Y" (di solito in header/
    footer di ogni pagina). Ritorna None se non trovata."""
    m = _VERSION_RE.search(text)
    if not m:
        return None
    return f"v{m.group(1)}"


def extract_metadata(pdf_bytes: bytes) -> ExtractedMetadata:
    """Estrae automaticamente i metadati da un PDF caricato.

    Errori di estrazione (type/version non riconosciuti) sollevano 400
    con messaggio diagnostico chiaro, cosi' l'admin capisce esattamente
    cosa correggere (chiedere al DPO un titolo standard, o aggiungere
    la riga "version X.Y" nel PDF).
    """
    validate_pdf(pdf_bytes)

    text = _read_pdf_text(pdf_bytes)

    detected_type = _detect_type(text)
    if not detected_type:
        raise HTTPException(
            status_code=400,
            detail=(
                "Cannot recognize document type from PDF title. "
                "Expected a heading like 'Terms of Use ...' or 'Informativa ...' "
                "in the first pages."
            ),
        )

    detected_version = _detect_version(text)
    if not detected_version:
        raise HTTPException(
            status_code=400,
            detail=(
                "Cannot extract version string from PDF. Expected a substring "
                "like 'version 1.0' somewhere in the document text "
                "(usually repeated in header/footer of each page)."
            ),
        )

    sha256 = hashlib.sha256(pdf_bytes).hexdigest()

    # Snapshot della lista vessatorie corrente al momento dell'upload.
    # None per documenti che non ne hanno (es. Privacy Notice).
    vexatious = VEXATIOUS_CLAUSES_DEFAULT.get(detected_type)

    return ExtractedMetadata(
        type=detected_type,
        version=detected_version,
        sha256=sha256,
        size_bytes=len(pdf_bytes),
        vexatious_clauses=list(vexatious) if vexatious else None,
    )


# ---------------------------------------------------------------------------
# Publish
# ---------------------------------------------------------------------------
_FILENAME_TYPE_PREFIX = {
    "terms_of_use": "Terms_of_use",
    "privacy_notice": "Privacy_notice",
}


def _build_filename(doc_type: str, version: str) -> str:
    """Costruisce il filename canonico del PDF in archivio.

    Pattern: {TypePrefix}_{version}_{YYYY-MM-DD}.pdf
    Es.: Terms_of_use_v1.0_2026-05-18.pdf
    """
    prefix = _FILENAME_TYPE_PREFIX[doc_type]
    date_str = utc_now().strftime("%Y-%m-%d")
    return f"{prefix}_{version}_{date_str}.pdf"


def build_public_url(filename: str) -> str:
    """URL pubblico assoluto sotto cui Caddy serve il file."""
    return f"{SITE_URL}{LEGAL_DOCUMENTS_URL_PREFIX}/{filename}"


def publish_new_version(
    db: Session,
    metadata: ExtractedMetadata,
    pdf_bytes: bytes,
    note: Optional[str] = None,
    publisher_user_id: Optional[int] = None,
    publisher_ip: Optional[str] = None,
    publisher_user_agent: Optional[str] = None,
) -> models.LegalDocument:
    """Pubblica una nuova versione di un documento legale.

    Atomico (per quanto possibile fra DB e filesystem):
      1) Verifica che NON esista gia' una riga (type, version) — UI di solito
         lo previene, ma il backend non si fida.
      2) Scrive il PDF su filesystem.
      3) Inserisce la nuova riga in `legal_documents` con `is_current=True`.
      4) Mette `is_current=False` sulla precedente versione corrente.
      5) Se `publisher_user_id` e' valorizzato, inserisce anche una riga
         `consents` che registra l'auto-accettazione del documento da parte
         dell'admin che lo sta pubblicando. Razionale: chi carica il PDF
         ne conosce e approva il contenuto; senza questa riga il middleware
         consent_enforcement bloccherebbe immediatamente l'admin appena
         pubblicato (chiedendogli di accettare quello che ha appena
         caricato lui stesso). `vexatious_clauses_approved` viene messo
         a True automaticamente se il documento ne ha: l'admin sta
         pubblicando il documento, quindi le accetta implicitamente.
      6) Commit transazione DB.

    Se 3-6 falliscono, rollback DB ma il file su disco resta. E'
    fastidio minore: la riga vecchia in DB resta "current" e il file
    orfano su disco verra' soprascritto al prossimo upload con stessa
    versione (o cancellato a mano). Non vale la pena introdurre logica
    di rollback filesystem.
    """
    # 1) Check duplicato (type, version) -> 409 chiaro.
    existing = (
        db.query(models.LegalDocument)
        .filter(
            models.LegalDocument.type == metadata.type,
            models.LegalDocument.version == metadata.version,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail=(
                f"A document with type={metadata.type!r} and "
                f"version={metadata.version!r} already exists. "
                f"To publish, bump the version in the PDF first."
            ),
        )

    # 2) Scrivi il file su disco. Crea la cartella se non esiste
    # (idempotente, sicuro al primo deploy).
    os.makedirs(LEGAL_DOCUMENTS_DIR, exist_ok=True)
    filename = _build_filename(metadata.type, metadata.version)
    full_path = os.path.join(LEGAL_DOCUMENTS_DIR, filename)
    # `xb` = scrittura binaria, fallisce se il file esiste gia' (extra
    # safety net oltre al check in DB sopra: filename include la versione,
    # quindi una collisione qui significa che qualcuno ha caricato due
    # documenti diversi con stessa versione nello stesso giorno).
    try:
        with open(full_path, "xb") as f:
            f.write(pdf_bytes)
    except FileExistsError:
        raise HTTPException(
            status_code=409,
            detail=(
                f"A file named {filename!r} already exists in the archive. "
                f"Bump the version or wait until tomorrow."
            ),
        )

    # 3-4) DB: nuova riga current + scolora la precedente.
    try:
        # Scolora la versione precedente (se esiste).
        db.query(models.LegalDocument).filter(
            models.LegalDocument.type == metadata.type,
            models.LegalDocument.is_current == True,  # noqa: E712
        ).update({"is_current": False})

        # Inserisci la nuova.
        new_doc = models.LegalDocument(
            type=metadata.type,
            version=metadata.version,
            # `file_path` salviamo solo il filename: l'URL pubblico si
            # costruisce con build_public_url(filename) ed e' immune a
            # cambi di LEGAL_DOCUMENTS_DIR / dominio.
            file_path=filename,
            sha256=metadata.sha256,
            published_at=utc_now(),
            is_current=True,
            vexatious_clauses=metadata.vexatious_clauses,
            note=(note or None),
        )
        db.add(new_doc)
        db.flush()  # serve l'id del nuovo doc per la riga consents sotto

        # Auto-accettazione del publisher. Evita che il middleware
        # consent_enforcement blocchi immediatamente l'admin appena
        # pubblicato chiedendogli di accettare cio' che ha appena caricato.
        if publisher_user_id is not None:
            auto_consent = models.Consent(
                user_id=publisher_user_id,
                legal_document_id=new_doc.id,
                accepted_at=utc_now(),
                ip_address=publisher_ip,
                user_agent=publisher_user_agent,
                method="admin_self_upload",
                vexatious_clauses_approved=bool(metadata.vexatious_clauses),
            )
            db.add(auto_consent)

        db.commit()
        db.refresh(new_doc)
    except Exception:
        db.rollback()
        # Lascio il file orfano su disco: il logging permette di trovarlo.
        logger.exception(
            "publish_new_version: DB commit fallito, file orfano su disco: %s",
            full_path,
        )
        raise

    logger.info(
        "Pubblicata nuova versione: type=%s version=%s file=%s sha256=%s",
        new_doc.type, new_doc.version, filename, metadata.sha256,
    )
    return new_doc
