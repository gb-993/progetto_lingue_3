from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import auth, glossary, languages, parameters, questions, users
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
app.include_router(parameters.router)
app.include_router(languages.router)
app.include_router(questions.router)
app.include_router(users.router)
