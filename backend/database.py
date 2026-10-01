from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from config import DATABASE_URL

# 30 connessioni (10 fisse + 20 extra) invece delle 15 di default: sotto carico
# FastAPI serve fino a 40 richieste in parallelo e con 15 si formava la coda
engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_size=10, max_overflow=20)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
