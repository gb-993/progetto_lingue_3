
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


def _serialize_doc_for_modal(doc: models.LegalDocument) -> dict:

    return {
        "id": doc.id,
        "type": doc.type,
        "version": doc.version,
        "public_url": build_public_url(doc.file_path),
        "vexatious_clauses": doc.vexatious_clauses,
        "published_at": doc.published_at.isoformat() if doc.published_at else None,
    }


def _has_vexatious(doc: models.LegalDocument) -> bool:
    return bool(doc.vexatious_clauses)


def _user_has_consented_to(db: Session, user_id: int, legal_document_id: int) -> bool:

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


@router.get("/required")
def get_required_consents(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):

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


class AcceptRequest(BaseModel):
    accepted_document_ids: list[int] = Field(min_length=1)
    vexatious_clauses_approved: bool = False


@router.post("/accept", status_code=201)
def accept_consents(
    payload: AcceptRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):

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

    obsolete = [d for d in docs if not d.is_current]
    if obsolete:
        raise HTTPException(
            status_code=409,
            detail=(
                "One or more documents are no longer the current version. "
                "Reload the page to see the latest version."
            ),
        )

    any_vexatious = any(_has_vexatious(d) for d in docs)
    if any_vexatious and not payload.vexatious_clauses_approved:
        raise HTTPException(
            status_code=400,
            detail=(
                "Specific approval required for vexatious clauses "
                "(art. 1341 c.c.). Please tick the second checkbox."
            ),
        )

    for d in docs:
        if _user_has_consented_to(db, current_user.id, d.id):
            raise HTTPException(
                status_code=409,
                detail=f"User has already accepted document id={d.id} ({d.type} {d.version}).",
            )

    ip_address = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")

    created: list[models.Consent] = []
    try:
        for d in docs:
            ever_accepted = _user_ever_accepted_type(db, current_user.id, d.type)
            method = "version_update_modal" if ever_accepted else "first_login_modal"

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
