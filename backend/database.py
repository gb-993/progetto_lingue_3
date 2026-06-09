from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from config import DATABASE_URL

# Crea il motore di connessione. URL costruito in config.py:
# - dev: legge da .env, fallback ai valori storici se mancano
# - prod: deve essere esplicitamente impostato (errore altrimenti)
# pool_pre_ping: verifica la connessione prima di riusarla dal pool. Senza,
# dopo un riavvio di Postgres (redeploy, crash) le connessioni morte nel
# pool causano 500 sulle prime richieste finche' non vengono riciclate.
engine = create_engine(DATABASE_URL, pool_pre_ping=True)

# Crea la fabbrica delle sessioni (le "transazioni" del database)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
