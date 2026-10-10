# PCM-Hub — avvio in locale

## Prerequisiti

1. Installare [Docker Desktop](https://www.docker.com/products/docker-desktop/) e lasciarlo acceso.

## Primo avvio

Tutti i comandi vanno lanciati da PowerShell nella root del progetto (tranne il primo).

**1. Scaricare il codice** (PowerShell nella cartella dove volete il progetto)

    git clone https://github.com/gb-993/progetto_lingue_3.git pcm-hub

**2. Creare il file `.env`**


| Variabile | Valore |
|---|---|
| `ENV` | `dev` |
| `SECRET_KEY` | una stringa casuale qualsiasi |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | le credenziali con cui farete login |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | valori a scelta |
| `DATABASE_URL` | `postgresql://<user>:<password>@db/<db>`, con gli stessi valori della riga sopra |
| `CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` |
| `SITE_URL` | `http://localhost:5173` |

**3. Avviare** (in quest'ordine)

    docker compose up -d db
    docker compose run --rm backend alembic upgrade head
    docker compose up -d

Il primo avvio richiede qualche minuto.

**4. Aprire il sito**

http://localhost:5173: login con `ADMIN_EMAIL` / `ADMIN_PASSWORD` scelte nel `.env`.

Il database parte vuoto. Per lavorare su dati reali chiedete un bundle di backup al maintainer.

## Se cambia `frontend/package.json`

Se Vite dà "Failed to resolve import", ricostruire il frontend:

    docker compose up -d --build --renew-anon-volumes frontend
