"""Documenti legali: tipo e versione letti dal PDF, e pubblicazione."""
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


MAX_PDF_SIZE = 10 * 1024 * 1024
TYPE_DETECTION_CHARS = 2000

# titoli riconosciuti per ogni tipo
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

_VERSION_RE = re.compile(r"version\s+(\d+\.\d+)", re.IGNORECASE)


@dataclass(frozen=True)
class ExtractedMetadata:
    """Dati letti dal PDF, usati da preview e publish."""
    type: str                       # "terms_of_use" | "privacy_notice"
    version: str                    # "v1.0", "v1.1", ...
    sha256: str
    size_bytes: int
    vexatious_clauses: Optional[list[str]]  # None se il documento non ne ha


PDF_MAGIC_HEADER = b"%PDF-"


def validate_pdf(pdf_bytes: bytes) -> None:
    """Errore se il file è vuoto, troppo grande o non è un PDF."""
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(pdf_bytes) > MAX_PDF_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File too large ({len(pdf_bytes)} bytes > {MAX_PDF_SIZE} bytes max).",
        )
    if not pdf_bytes.startswith(PDF_MAGIC_HEADER):
        raise HTTPException(
            status_code=400,
            detail="File does not look like a PDF (missing %PDF- header).",
        )


def _read_pdf_text(pdf_bytes: bytes, max_chars: Optional[int] = None) -> str:
    """Testo di tutte le pagine (al massimo `max_chars`)."""
    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
    except Exception as exception:
        raise HTTPException(
            status_code=400,
            detail=f"Unable to parse the PDF: {exception}",
        )

    parts: list[str] = []
    total_chars = 0
    for page in reader.pages:
        try:
            page_text = page.extract_text() or ""
        except Exception:
            # una pagina rotta non blocca le altre
            page_text = ""
        parts.append(page_text)
        total_chars += len(page_text)
        if max_chars is not None and total_chars >= max_chars:
            break

    text = "\n".join(parts)
    if max_chars is not None:
        text = text[:max_chars]
    return text


def _detect_type(text: str) -> Optional[str]:
    title_text = text[:TYPE_DETECTION_CHARS].upper()
    for type_value, patterns in _TYPE_PATTERNS:
        for pattern in patterns:
            if pattern.upper() in title_text:
                return type_value
    return None


def _detect_version(text: str) -> Optional[str]:
    match = _VERSION_RE.search(text)
    if not match:
        return None
    return f"v{match.group(1)}"


def extract_metadata(pdf_bytes: bytes) -> ExtractedMetadata:
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

    # clausole vessatorie di oggi; None se il tipo non ne ha
    vexatious_clauses = VEXATIOUS_CLAUSES_DEFAULT.get(detected_type)

    return ExtractedMetadata(
        type=detected_type,
        version=detected_version,
        sha256=sha256,
        size_bytes=len(pdf_bytes),
        vexatious_clauses=list(vexatious_clauses) if vexatious_clauses else None,
    )


_FILENAME_TYPE_PREFIX = {
    "terms_of_use": "Terms_of_use",
    "privacy_notice": "Privacy_notice",
}


def _build_filename(doc_type: str, version: str) -> str:
    """Nome file: {Tipo}_{versione}_{data}.pdf."""
    type_prefix = _FILENAME_TYPE_PREFIX[doc_type]
    date_str = utc_now().strftime("%Y-%m-%d")
    return f"{type_prefix}_{version}_{date_str}.pdf"


def build_public_url(filename: str) -> str:
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
    """Pubblica una nuova versione: file, DB e consenso del publisher."""
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

    os.makedirs(LEGAL_DOCUMENTS_DIR, exist_ok=True)
    filename = _build_filename(metadata.type, metadata.version)
    full_path = os.path.join(LEGAL_DOCUMENTS_DIR, filename)
    try:
        with open(full_path, "xb") as pdf_file:
            pdf_file.write(pdf_bytes)
    except FileExistsError:
        raise HTTPException(
            status_code=409,
            detail=(
                f"A file named {filename!r} already exists in the archive. "
                f"Bump the version or wait until tomorrow."
            ),
        )

    try:
        db.query(models.LegalDocument).filter(
            models.LegalDocument.type == metadata.type,
            models.LegalDocument.is_current == True,  # noqa: E712
        ).update({"is_current": False})

        new_document = models.LegalDocument(
            type=metadata.type,
            version=metadata.version,
            file_path=filename,
            sha256=metadata.sha256,
            published_at=utc_now(),
            is_current=True,
            vexatious_clauses=metadata.vexatious_clauses,
            note=(note or None),
        )
        db.add(new_document)
        db.flush()  # serve l'id per il consenso

        # auto-consenso, sennò il middleware blocca l'admin
        if publisher_user_id is not None:
            auto_consent = models.Consent(
                user_id=publisher_user_id,
                legal_document_id=new_document.id,
                accepted_at=utc_now(),
                ip_address=publisher_ip,
                user_agent=publisher_user_agent,
                method="admin_self_upload",
                vexatious_clauses_approved=bool(metadata.vexatious_clauses),
            )
            db.add(auto_consent)

        db.commit()
        db.refresh(new_document)
    except Exception:
        db.rollback()
        logger.exception(
            "publish_new_version: DB commit fallito, file orfano su disco: %s",
            full_path,
        )
        raise

    logger.info(
        "Pubblicata nuova versione: type=%s version=%s file=%s sha256=%s",
        new_document.type, new_document.version, filename, metadata.sha256,
    )
    return new_document
