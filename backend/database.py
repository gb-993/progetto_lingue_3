import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Prende le credenziali direttamente dal docker-compose.yml
SQLALCHEMY_DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://pcm_user:pcm_password@db/pcm_hub"
)

# Crea il motore di connessione
engine = create_engine(SQLALCHEMY_DATABASE_URL)

# Crea la fabbrica delle sessioni (le "transazioni" del database)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)