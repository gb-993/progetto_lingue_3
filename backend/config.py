
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


ENV = env("ENV", "dev")
IS_PROD = ENV == "prod"

if IS_PROD:
    SECRET_KEY = env("SECRET_KEY")
    if not SECRET_KEY:
        raise RuntimeError(
            "SECRET_KEY non impostata. In produzione è obbligatoria. "
            "Impostala come variabile d'ambiente."
        )
else:
    SECRET_KEY = env("SECRET_KEY", "dev-insecure-change-me")

ALGORITHM = env("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = env_int("ACCESS_TOKEN_EXPIRE_MINUTES", 30)


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
        return "postgresql://pcm_user:pcm_password@db/pcm_hub"
    return f"postgresql://{user}:{pwd}@{host}:{port}/{db}"


DATABASE_URL = _build_database_url()

_default_cors = "" if IS_PROD else "http://localhost:5173,http://127.0.0.1:5173"
CORS_ORIGINS = env_list("CORS_ORIGINS", _default_cors)

CORS_ORIGIN_REGEX = None if IS_PROD else r"http://(localhost|127\.0\.0\.1)(:\d+)?"


SITE_URL = (env("SITE_URL", "") or "").rstrip("/")
if IS_PROD and not SITE_URL:
    raise RuntimeError(
        "SITE_URL non impostata. In produzione e' obbligatoria: "
        "es. https://hub.parametricomparison.unimore.it"
    )
if not SITE_URL:
    SITE_URL = "http://localhost:5173"


SMTP_HOST = env("SMTP_HOST")
SMTP_PORT = env_int("SMTP_PORT", 587)
SMTP_USER = env("SMTP_USER")
SMTP_PASSWORD = env("SMTP_PASSWORD")
SMTP_FROM = env("SMTP_FROM") or SMTP_USER

if IS_PROD and not (SMTP_HOST and SMTP_USER and SMTP_PASSWORD and SMTP_FROM):
    raise RuntimeError(
        "SMTP_HOST, SMTP_USER, SMTP_PASSWORD e SMTP_FROM sono obbligatorie "
        "in produzione. Impostale come variabili d'ambiente prima del deploy."
    )

SMTP_ENABLED = bool(SMTP_HOST and SMTP_USER and SMTP_PASSWORD and SMTP_FROM)


VEXATIOUS_CLAUSES_DEFAULT: dict[str, list[str]] = {
    "terms_of_use": ["7", "8", "9.2", "11"],
}

LEGAL_DOCUMENTS_DIR = env("LEGAL_DOCUMENTS_DIR", "/srv/legal_documents" if IS_PROD else "./legal_documents_local")

LEGAL_DOCUMENTS_URL_PREFIX = "/legal-docs"
