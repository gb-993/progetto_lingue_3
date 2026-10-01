"""Ricalcolo in background dopo modifiche allo schema."""
from __future__ import annotations

import logging

import models
from database import SessionLocal
from services.param_consolidate import recompute_and_persist_language_parameter
from services.dag_eval import run_dag_for_language

logger = logging.getLogger(__name__)


def recompute_parameter_for_all_languages(parameter_id: str) -> None:
    """Ricalcola value_orig + DAG del parametro per tutte le lingue."""
    list_db = SessionLocal()
    try:
        language_ids = [r[0] for r in list_db.query(models.Language.id).all()]
    finally:
        list_db.close()

    for lang_id in language_ids:
        db = SessionLocal()
        try:
            recompute_and_persist_language_parameter(lang_id, parameter_id, db)
            run_dag_for_language(lang_id, db)
            db.commit()
        except Exception as e:
            db.rollback()
            logger.error(
                "background recompute failed for parameter %s, language %s: %s",
                parameter_id, lang_id, e, exc_info=True,
            )
        finally:
            db.close()
