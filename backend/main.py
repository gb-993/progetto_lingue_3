from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# --- AGGIUNTO: Importiamo models e l'engine del database ---
import models
from database import engine

# --- AGGIUNTO: Crea le tabelle mancanti nel database all'avvio ---
models.Base.metadata.create_all(bind=engine)

from routers import (auth,
                     glossary,
                     languages,
                     parameters,
                     questions,
                     users,
                     motivations,
                     compilation,
                     instructions,
                     backup,
                     site_content,
                     tablea)

app = FastAPI(title="PCM-Hub API")

# Abilita le chiamate dal frontend React
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
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
app.include_router(backup.router)
app.include_router(site_content.router)
app.include_router(tablea.router)
