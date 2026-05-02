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
