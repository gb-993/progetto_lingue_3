from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from config import DATABASE_URL

# Crea il motore di connessione. URL costruito in config.py:
# - dev: legge da .env, fallback ai valori storici se mancano
# - prod: deve essere esplicitamente impostato (errore altrimenti)
engine = create_engine(DATABASE_URL)

# Crea la fabbrica delle sessioni (le "transazioni" del database)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
