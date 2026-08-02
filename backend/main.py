import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded



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
                     whats_new,
                     email,
                     presence)

@asynccontextmanager
async def lifespan(_app: FastAPI):
    bootstrap_first_admin()
    yield


app = FastAPI(
    title="PCM-Hub API",
    lifespan=lifespan,
    docs_url=None if IS_PROD else "/docs",
    redoc_url=None if IS_PROD else "/redoc",
    openapi_url=None if IS_PROD else "/openapi.json",
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(ConsentEnforcementMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_origin_regex=CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "X-Skipped-Languages"],
)

@app.get("/healthz", include_in_schema=False)
def healthz():
    return {"status": "ok"}



@app.get("/legal-docs/{filename}", include_in_schema=False)
def serve_legal_doc(filename: str):
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
app.include_router(legal_documents.public_router)
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
app.include_router(whats_new.router)
app.include_router(email.router)
app.include_router(presence.router)
