"""Fixture condivise: DB SQLite in-memory nuovo per ogni test."""
import os
import sys
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

# così "import models" funziona lanciando pytest da backend/
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import models  # noqa: E402


@pytest.fixture
def db_session() -> Session:
    """DB SQLite in-memory con lo schema dei modelli."""
    engine = create_engine("sqlite:///:memory:")
    models.Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()
