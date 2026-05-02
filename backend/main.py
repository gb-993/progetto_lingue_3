from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Le tabelle sono gestite esclusivamente da alembic.
# NON usare metadata.create_all qui: confligge con le migrazioni
# (se aggiungi un modello nuovo, create_all crea la tabella all'avvio
# e poi `alembic upgrade head` fallisce con DuplicateTable).
# Per applicare nuove migrazioni: docker compose exec backend alembic upgrade head

from config import CORS_ORIGINS, CORS_ORIGIN_REGEX
from routers import (auth,
                     glossary,
                     languages,
                     parameters,
                     parameters_backup,
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
                     archived_questions)

app = FastAPI(title="PCM-Hub API")

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

app.include_router(auth.router)
app.include_router(glossary.router)
app.include_router(glossary.public_router)
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
app.include_router(archived_questions.router)
