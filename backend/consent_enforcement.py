"""
Middleware per enforcement dei consensi legali.
Blocca con 403 le richieste autenticate di utenti che non hanno accettato
"""
from __future__ import annotations

import logging

from fastapi import Request
from fastapi.responses import JSONResponse
from jose import JWTError, jwt
from starlette.middleware.base import BaseHTTPMiddleware

import models
from auth import ALGORITHM, SECRET_KEY
from database import SessionLocal
from dependencies import resolve_user_from_sub


logger = logging.getLogger(__name__)


CONSENT_BYPASS_PREFIXES: tuple[str, ...] = (
    "/auth/",
    "/api/me",
    "/api/consents/",
    "/api/public/",
    "/api/legal-documents/",
    "/healthz",
    "/docs",
    "/redoc",
    "/openapi.json",
)

CONSENT_BYPASS_EXACT: frozenset[str] = frozenset({
    "/api/glossary",
})


def _path_bypasses_consent_check(path: str) -> bool:
    if path in CONSENT_BYPASS_EXACT:
        return True
    return any(path.startswith(p) for p in CONSENT_BYPASS_PREFIXES)


class ConsentEnforcementMiddleware(BaseHTTPMiddleware):

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if _path_bypasses_consent_check(path):
            return await call_next(request)

        auth_header = request.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            return await call_next(request)

        token = auth_header[7:]
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            sub = payload.get("sub")
        except JWTError:
            return await call_next(request)

        if not sub:
            return await call_next(request)

        db = SessionLocal()
        try:
            user = resolve_user_from_sub(db, sub)
            if user is None:
                return await call_next(request)

            current_docs = (
                db.query(models.LegalDocument)
                .filter(models.LegalDocument.is_current == True)  # noqa: E712
                .all()
            )

            for doc in current_docs:
                has_consent = (
                    db.query(models.Consent.id)
                    .filter(
                        models.Consent.user_id == user.id,
                        models.Consent.legal_document_id == doc.id,
                        models.Consent.revoked_at.is_(None),
                    )
                    .first()
                    is not None
                )
                if not has_consent:
                    return JSONResponse(
                        status_code=403,
                        content={
                            "detail": "Acceptance of latest legal documents required.",
                            "required_acceptance": True,
                        },
                    )
        finally:
            db.close()

        return await call_next(request)
