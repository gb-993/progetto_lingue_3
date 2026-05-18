from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

# Le tabelle sono gestite esclusivamente da alembic.
# NON usare metadata.create_all qui: confligge con le migrazioni
# (se aggiungi un modello nuovo, create_all crea la tabella all'avvio
# e poi `alembic upgrade head` fallisce con DuplicateTable).
# Per applicare nuove migrazioni: docker compose exec backend alembic upgrade head

from config import CORS_ORIGINS, CORS_ORIGIN_REGEX, IS_PROD
from rate_limit import limiter
from services.admin_bootstrap import bootstrap_first_admin
from routers import (auth,
                     glossary,
                     languages,
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


app.include_router(auth.router)
app.include_router(glossary.router)
app.include_router(glossary.public_router)
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
