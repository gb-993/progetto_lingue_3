import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

# Le tabelle sono gestite esclusivamente da alembic.
# NON usare metadata.create_all qui: confligge con le migrazioni
# (se aggiungi un modello nuovo, create_all crea la tabella all'avvio
# e poi `alembic upgrade head` fallisce con DuplicateTable).
# Per applicare nuove migrazioni: docker compose exec backend alembic upgrade head

from config import CORS_ORIGINS, CORS_ORIGIN_REGEX, IS_PROD, LEGAL_DOCUMENTS_DIR
from consent_enforcement import ConsentEnforcementMiddleware
from rate_limit import limiter
from services.admin_bootstrap import bootstrap_first_admin
from routers import (auth,
                     consents,
                     glossary,
                     languages,
                     legal_documents,
                     parameters,
                     parameters_backup,
                     parameters_graph,
                     questions,
                     users,
                     motivations,
                     compilation,
                     instructions,
                     backup,
                     site_content,
                     tablea,
                     queries,
                     dashboard,
                     export,
                     import_excel,
                     history,
                     taxonomy,
                     migration,
                     backup_restore,
                     recompute,
                     archived_questions,
                     email)

@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Crea il primo admin se la tabella users e' vuota. Idempotente: dal
    # secondo avvio in poi e' un no-op. Le credenziali in prod arrivano
    # da ADMIN_EMAIL/ADMIN_PASSWORD (config.py impone fail-fast se mancano).
    bootstrap_first_admin()
    yield


# In prod nascondiamo /docs, /redoc e /openapi.json: senza, chiunque
# vede tutta la mappa degli endpoint e dei payload. In dev restano
# accessibili come al solito per l'autocompletion / il debug.
app = FastAPI(
    title="PCM-Hub API",
    lifespan=lifespan,
    docs_url=None if IS_PROD else "/docs",
    redoc_url=None if IS_PROD else "/redoc",
    openapi_url=None if IS_PROD else "/openapi.json",
)

# Rate-limit: registra il limiter sull'app e l'handler che restituisce
# 429 quando una route decorata supera la sua quota (vedi auth.py).
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Consent enforcement: blocca con 403 le richieste autenticate di utenti che
# non hanno ancora accettato la versione corrente dei documenti legali.
# IMPORTANTE: i middleware si eseguono nell'ordine INVERSO di registrazione
# (LIFO). Questo va aggiunto PRIMA del CORS middleware nel codice, cosi'
# CORS resta il primo a girare (e gestisce correttamente le richieste
# OPTIONS preflight da Vite in dev). La whitelist dei path che bypassano
# il check e' in consent_enforcement.py.
app.add_middleware(ConsentEnforcementMiddleware)

# CORS: whitelist letta da .env (CORS_ORIGINS, comma-separated).
# In dev: default localhost Vite (gestito in config.py).
# In prod: deve essere impostato nel .env / variabili Portainer col dominio reale.
# allow_credentials=True è incompatibile con "*", quindi NON usare wildcard.
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_origin_regex=CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "X-Skipped-Languages"],
)

# Health check banale: serve a docker (healthcheck nel compose) e a un
# eventuale monitoring esterno per verificare che il processo sia vivo.
# NON pinga il DB: se vuoi un check piu' "deep" creiamo /healthz/deep.
@app.get("/healthz", include_in_schema=False)
def healthz():
    return {"status": "ok"}


# Serve i PDF dei documenti legali caricati via UI admin (vedi router
# legal_documents). In PROD Caddy intercetta /legal-docs/* PRIMA del
# backend e li serve direttamente dal volume nominato `legal_archive`
# montato in /srv/legal_documents — quindi questo endpoint backend
# in pratica non viene mai colpito in produzione. In DEV invece non
# c'e' Caddy: Vite proxia /legal-docs/* qui (vedi vite.config.js
# server.proxy) e il backend serve il file dal disco.
#
# Sicurezza: filename validato strict (no path traversal). Solo PDF
# (l'estensione e' enforced sia in upload che qui).
@app.get("/legal-docs/{filename}", include_in_schema=False)
def serve_legal_doc(filename: str):
    # Anti path-traversal: rifiuta nomi che contengono separatori di path
    # o ".." o sono assoluti. Pattern delegato al filesystem -> os.path.basename
    # restituisce solo l'ultimo segmento, quindi se basename != filename
    # l'utente ha provato a fare furberie.
    if filename != os.path.basename(filename) or filename.startswith("."):
        raise HTTPException(status_code=400, detail="Invalid filename.")

    full_path = os.path.join(LEGAL_DOCUMENTS_DIR, filename)
    if not os.path.isfile(full_path):
        raise HTTPException(status_code=404, detail="Document not found.")

    return FileResponse(
        full_path,
        media_type="application/pdf",
        filename=filename,
    )


app.include_router(auth.router)
app.include_router(glossary.router)
app.include_router(glossary.public_router)
app.include_router(legal_documents.router)
app.include_router(consents.router)
app.include_router(parameters_graph.router)
app.include_router(parameters.router)
app.include_router(languages.router)
app.include_router(questions.router)
app.include_router(users.router)
app.include_router(motivations.router)
app.include_router(compilation.router)
app.include_router(instructions.router)
app.include_router(parameters_backup.router)
app.include_router(backup.router)
app.include_router(site_content.router)
app.include_router(tablea.router)
app.include_router(queries.router)
app.include_router(dashboard.router)
app.include_router(export.router)
app.include_router(import_excel.router)
app.include_router(history.router)
app.include_router(taxonomy.router)
app.include_router(migration.router)
app.include_router(backup_restore.router)
app.include_router(recompute.router)
app.include_router(archived_questions.router)
app.include_router(email.router)
