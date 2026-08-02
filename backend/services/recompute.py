"""Per ricalcolare value_orig + DAG dopo modifiche allo schema.

Usati quando una modifica di metadati (Question.is_active, ParameterDef.is_active,
spostamento di una question tra parametri, wipe dei dati collegati...) puo'
invalidare il valore consolidato di uno o piu' parametri. Il ricalcolo gira come
FastAPI BackgroundTask, fuori dal ciclo request/response, in modo che l'admin
non aspetti.
"""
from __future__ import annotations

import logging

import models
from database import SessionLocal
from services.param_consolidate import recompute_and_persist_language_parameter
from services.dag_eval import run_dag_for_language

logger = logging.getLogger(__name__)


def recompute_parameter_for_all_languages(parameter_id: str) -> None:
    """Ricalcola value_orig + DAG di un parametro per TUTTE le lingue."""
    
    # Elenco lingue in una sessione dedicata e breve, subito chiusa.
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
