"""
Fixture pytest condivise per i test backend.

Fornisce un DB SQLite in-memory pulito per ogni test, con metadata.create_all
applicato dai modelli SQLAlchemy.
"""
import os
import sys
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

# Permette agli import "import models" di funzionare quando pytest gira da backend/
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import models  # noqa: E402


@pytest.fixture
def db_session() -> Session:
    """SQLite in-memory, schema creato dai modelli, dropalo alla fine."""
    engine = create_engine("sqlite:///:memory:")
    models.Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()
