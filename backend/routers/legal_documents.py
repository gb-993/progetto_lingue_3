
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

# consent_enforcement.CONSENT_BYPASS_PREFIXES.
public_router = APIRouter(
    prefix="/api/legal-documents",
    tags=["LegalDocuments"],
)


# ---------------------------------------------------------------------------
def _serialize(doc: models.LegalDocument) -> dict:

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


@router.get("")
def list_all(
    db: Session = Depends(get_db),
    _admin: models.User = Depends(require_admin),
):

    docs = (
        db.query(models.LegalDocument)
        .order_by(
            models.LegalDocument.type.asc(),
            models.LegalDocument.published_at.desc(),
        )
        .all()
    )
    return [_serialize(d) for d in docs]


@router.post("/preview")
async def preview_upload(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _admin: models.User = Depends(require_admin),
):

    pdf_bytes = await file.read()
    metadata = extract_metadata(pdf_bytes)

    already = (
        db.query(models.LegalDocument)
        .filter(
            models.LegalDocument.type == metadata.type,
            models.LegalDocument.version == metadata.version,
        )
        .first()
    )

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


@router.post("", status_code=201)
async def publish(
    request: Request,
    file: UploadFile = File(...),
    note: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):

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


@public_router.get("/current")
def get_current_documents(db: Session = Depends(get_db)):

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
