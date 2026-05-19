"""Middleware ASGI che blocca le richieste di utenti non in regola con i consensi.

Filosofia: il modal del frontend e' una difesa UX (l'utente vede il modal
e non puo' cliccare altro). Questo middleware e' la difesa server-side:
chi tentasse di bypassare il modal chiamando direttamente le API (via
curl, postman, script) riceve 403 finche' non ha accettato la versione
corrente dei documenti legali (Terms of Use + Privacy Notice).

Si applica a TUTTI gli endpoint del backend, eccetto un set esplicito di
path che devono restare accessibili anche a utenti non-consented:

  - `/auth/*`        : login, forgot/reset password (per definizione no auth)
  - `/api/me`        : profilo utente; l'AuthContext del frontend chiama
                       questa rotta subito dopo il login, prima ancora del
                       modal — non puo' essere bloccata
  - `/api/consents/*`: per accettare i consensi bisogna poter chiamare
                       queste rotte (altrimenti blocco circolare)
  - `/api/public/*`  : endpoint pubblici (mappa home, site content)
  - `/api/glossary`  : public_router del glossario (esatto, no figli;
                       /api/admin/glossary/* invece e' protetto)
  - `/healthz`       : health check per docker
  - `/docs`, `/redoc`, `/openapi.json`: solo dev, in prod sono nascosti

Performance: una query in piu' per ogni richiesta autenticata fuori
whitelist. Su un sito a basso traffico (decine di utenti) e' trascurabile.
Se in futuro il traffico cresce, si puo' denormalizzare aggiungendo un
campo `User.consent_ok` aggiornato a) all'accept dell'utente, b) quando
viene caricato un nuovo legal_document is_current.
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


logger = logging.getLogger(__name__)


# Path PREFIX che bypassano il check consents. Match con startswith.
CONSENT_BYPASS_PREFIXES: tuple[str, ...] = (
    "/auth/",
    "/api/me",
    "/api/consents/",
    "/api/public/",
    # Endpoint pubblico delle versioni correnti dei documenti legali.
    # Usato dal footer del sito anche da utenti loggati ma non ancora in
    # regola con i consensi (vedi public_router in routers/legal_documents).
    # Solo questo prefix: /api/admin/legal-documents/* resta protetto.
    "/api/legal-documents/",
    "/healthz",
    "/docs",
    "/redoc",
    "/openapi.json",
)

# Path ESATTI che bypassano il check (no figli). Usato per casi tipo
# `/api/glossary` dove vogliamo lasciare passare il public_router ma
# bloccare `/api/admin/glossary/*` (gestito da prefix /api/admin/ NON in
# whitelist, quindi cade nel check).
CONSENT_BYPASS_EXACT: frozenset[str] = frozenset({
    "/api/glossary",
})


def _path_bypasses_consent_check(path: str) -> bool:
    if path in CONSENT_BYPASS_EXACT:
        return True
    return any(path.startswith(p) for p in CONSENT_BYPASS_PREFIXES)


class ConsentEnforcementMiddleware(BaseHTTPMiddleware):
    """Blocca con 403 le richieste autenticate di utenti non in regola.

    Algoritmo:
      1. Path in whitelist? passa.
      2. Header Authorization assente o malformato? passa (l'endpoint
         sotto decidera' se serve auth: alcuni endpoint sono pubblici,
         il middleware non sa quali).
      3. Token JWT non decodificabile o senza `sub`? passa (idem).
      4. Utente non trovato nel DB? passa (caso raro: token valido ma
         utente nel frattempo eliminato — il prossimo dependency check
         dell'endpoint rispondera' 401).
      5. Per ogni legal_document is_current, l'utente ha un Consent
         attivo (revoked_at IS NULL)? Se manca anche solo uno -> 403
         con `required_acceptance=True` nel body (flag che il frontend
         puo' leggere per scattare la modal di re-accettazione).
    """
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
            email = payload.get("sub")
        except JWTError:
            return await call_next(request)

        if not email:
            return await call_next(request)

        # Nuova sessione DB ad hoc per il middleware (non possiamo riusare
        # `get_db` qui perche' siamo prima del dependency injection FastAPI).
        # close() in finally per evitare leak di connessioni al pool.
        db = SessionLocal()
        try:
            user = db.query(models.User).filter(models.User.email == email).first()
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
