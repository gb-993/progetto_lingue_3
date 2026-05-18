"""
Configurazione centralizzata letta da variabili d'ambiente.

In sviluppo i valori arrivano dal file `.env` montato dal docker-compose
(via `env_file`). In produzione vengono iniettati direttamente da
Portainer (o dal sistema di orchestrazione) e .env NON deve esistere.

Pattern: ENV=dev consente fallback comodi; ENV=prod impone i valori
sensibili (SECRET_KEY) e fa partire l'app SOLO se presenti.
"""
import os


def env(key: str, default: str | None = None) -> str | None:
    return os.environ.get(key, default)


def env_bool(key: str, default: bool = False) -> bool:
    v = os.environ.get(key)
    if v is None:
        return default
    return str(v).lower() in ("1", "true", "yes", "on")


def env_int(key: str, default: int) -> int:
    v = os.environ.get(key)
    if v is None or v == "":
        return default
    return int(v)


def env_list(key: str, default: str = "") -> list[str]:
    raw = os.environ.get(key, default)
    return [x.strip() for x in raw.split(",") if x.strip()]


# ---------------------- Ambiente ----------------------
ENV = env("ENV", "dev")
IS_PROD = ENV == "prod"

# ---------------------- Auth / JWT ----------------------
if IS_PROD:
    SECRET_KEY = env("SECRET_KEY")
    if not SECRET_KEY:
        raise RuntimeError(
            "SECRET_KEY non impostata. In produzione è obbligatoria. "
            "Impostala come variabile d'ambiente."
        )
else:
    # In dev usiamo un default solo se manca, ma logghiamo un avviso
    SECRET_KEY = env("SECRET_KEY", "dev-insecure-change-me")

ALGORITHM = env("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = env_int("ACCESS_TOKEN_EXPIRE_MINUTES", 30)


# ---------------------- Bootstrap admin ----------------------
# Credenziali del primo admin creato in automatico all'avvio quando la
# tabella `users` è vuota (vedi services/admin_bootstrap.py). Dopo che
# almeno un utente esiste il bootstrap diventa no-op: cambi password e
# nuovi utenti non vengono mai sovrascritti.
#
# In prod entrambe le variabili sono obbligatorie: senza, l'app si
# rifiuta di partire (stessa filosofia di SECRET_KEY) per evitare di
# esporre online un'istanza con un admin a credenziali di default.
ADMIN_EMAIL = env("ADMIN_EMAIL")
ADMIN_PASSWORD = env("ADMIN_PASSWORD")
if IS_PROD and (not ADMIN_EMAIL or not ADMIN_PASSWORD):
    raise RuntimeError(
        "ADMIN_EMAIL e ADMIN_PASSWORD sono obbligatorie in produzione. "
        "Impostale come variabili d'ambiente prima del primo deploy: "
        "verranno usate per creare il primo admin quando il DB è vuoto."
    )


# ---------------------- Database ----------------------
def _build_database_url() -> str:
    explicit = env("DATABASE_URL")
    if explicit:
        return explicit
    user = env("POSTGRES_USER")
    pwd = env("POSTGRES_PASSWORD")
    host = env("POSTGRES_HOST", "db")
    port = env("POSTGRES_PORT", "5432")
    db = env("POSTGRES_DB")
    if not (user and pwd and db):
        if IS_PROD:
            raise RuntimeError(
                "Credenziali database mancanti: imposta DATABASE_URL "
                "oppure POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB."
            )
        # Fallback dev coerente con docker-compose storico
        return "postgresql://pcm_user:pcm_password@db/pcm_hub"
    return f"postgresql://{user}:{pwd}@{host}:{port}/{db}"


DATABASE_URL = _build_database_url()

# ---------------------- CORS ----------------------
# In dev includiamo automaticamente le origini Vite locali se l'utente
# non ha specificato nulla; in prod la lista DEVE essere esplicita.
_default_cors = "" if IS_PROD else "http://localhost:5173,http://127.0.0.1:5173"
CORS_ORIGINS = env_list("CORS_ORIGINS", _default_cors)

# Solo in dev: permettiamo qualsiasi porta su localhost/127.0.0.1.
# Vite ripiega su 5174/5175/... quando 5173 è già occupato (es. da un'altra
# istanza o dal container docker), e dover ricordarsi di aggiungerle a mano
# è una rottura. In prod questo regex resta None: vale solo la whitelist.
CORS_ORIGIN_REGEX = None if IS_PROD else r"http://(localhost|127\.0\.0\.1)(:\d+)?"


# ---------------------- Site URL ----------------------
# URL pubblico del sito, usato per costruire i link che finiscono nelle
# mail (welcome, reset password, ...). In prod obbligatorio: senza, i
# link nelle mail sarebbero rotti.
SITE_URL = (env("SITE_URL", "") or "").rstrip("/")
if IS_PROD and not SITE_URL:
    raise RuntimeError(
        "SITE_URL non impostata. In produzione e' obbligatoria: "
        "es. https://hub.parametricomparison.unimore.it"
    )
if not SITE_URL:
    # Fallback dev: l'utente raggiunge il sito su Vite a 5173.
    SITE_URL = "http://localhost:5173"


# ---------------------- SMTP ----------------------
# Configurazione del server SMTP per l'invio di mail transazionali
# (reset password, welcome, notifiche admin). Stessa filosofia di
# SECRET_KEY/ADMIN_*: in dev sono opzionali (se manca SMTP_HOST il
# servizio email diventa un no-op che logga e ritorna), in prod sono
# obbligatorie e l'app non parte senza.
SMTP_HOST = env("SMTP_HOST")
SMTP_PORT = env_int("SMTP_PORT", 587)
SMTP_USER = env("SMTP_USER")
SMTP_PASSWORD = env("SMTP_PASSWORD")
# Se SMTP_FROM non e' impostato ripieghiamo su SMTP_USER: nel caso
# Gmail/Workspace il From deve coincidere col mittente autenticato.
SMTP_FROM = env("SMTP_FROM") or SMTP_USER

if IS_PROD and not (SMTP_HOST and SMTP_USER and SMTP_PASSWORD and SMTP_FROM):
    raise RuntimeError(
        "SMTP_HOST, SMTP_USER, SMTP_PASSWORD e SMTP_FROM sono obbligatorie "
        "in produzione. Impostale come variabili d'ambiente prima del deploy."
    )

# Flag derivato: True se possiamo davvero inviare mail. Usato dal servizio
# email per decidere se contattare il server o diventare un no-op silenzioso.
SMTP_ENABLED = bool(SMTP_HOST and SMTP_USER and SMTP_PASSWORD and SMTP_FROM)


# ---------------------- Documenti legali ----------------------
# Clausole vessatorie ex art. 1341 c.c. dei Terms of Use. Quando un admin
# carica una nuova versione del documento (vedi router admin legal_documents)
# la lista viene COPIATA come snapshot nella riga di `legal_documents`,
# cosi' resta congelata per quella versione anche se in futuro il default
# cambia. Le versioni gia' accettate dagli utenti non vengono mai toccate.
#
# Identificazione interna basata sull'art. 1341 c.c., NON ancora confermata
# da ufficio legale Unimore (vedi PRIVACY_TODO_DPO.md, sez. 4). Se la
# conferma cambia la lista, modifica qui sotto e fai redeploy.
#
# - Sez. 7  : Limitation of Liability
# - Sez. 8  : Account Suspension or Termination
# - Sez. 9.2: License Grant (licenza perpetua sui dati caricati)
# - Sez. 11 : Amendments (modifica unilaterale)
#
# Documenti senza clausole vessatorie (es. Privacy Notice) non compaiono
# in questo dict: il loro snapshot in legal_documents.vexatious_clauses
# resta NULL e nel modal frontend la seconda checkbox non viene mostrata.
VEXATIOUS_CLAUSES_DEFAULT: dict[str, list[str]] = {
    "terms_of_use": ["7", "8", "9.2", "11"],
}

# Cartella su filesystem dove vengono salvati i PDF caricati dall'admin
# (versioni storiche di ToU e Privacy Notice). In produzione punta a un
# volume Docker condiviso tra backend e Caddy, cosi' i file scritti dal
# backend sono subito serviti da Caddy sotto /legal-docs/* (vedi Caddyfile
# e docker-compose.prod.yml).
#
# In dev fallback a una cartella locale: i PDF caricati in dev NON sono
# automaticamente serviti da Vite, ma e' sufficiente per testare il flusso
# di upload e la scrittura su DB.
LEGAL_DOCUMENTS_DIR = env("LEGAL_DOCUMENTS_DIR", "/srv/legal_documents" if IS_PROD else "./legal_documents_local")

# URL pubblico sotto cui Caddy serve i file di LEGAL_DOCUMENTS_DIR.
# Costruito sommando SITE_URL e questo prefisso, es:
#   https://hub.parametricomparison.unimore.it/legal-docs/Terms_of_use_v1.0_2026-05-18.pdf
# Deve coincidere con l'handle in Caddyfile.
LEGAL_DOCUMENTS_URL_PREFIX = "/legal-docs"
