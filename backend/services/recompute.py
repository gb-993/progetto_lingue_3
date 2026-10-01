"""Ricalcolo dei valori dei parametri: i punti di ingresso usati dal resto del sito."""
from __future__ import annotations

import logging
from typing import Callable, List, Optional

from fastapi import BackgroundTasks
from sqlalchemy import func
from sqlalchemy.orm import Session

import models
from database import SessionLocal
from services.param_consolidate import recompute_and_persist_language_parameter
from services.dag_eval import DagReport, run_dag_for_language
from services.excel_import import ImportError as ImportRowError, ImportReport

logger = logging.getLogger(__name__)

# sheet che cambiano le regole del calcolo per tutte le lingue
SCHEMA_SHEETS = {"Parameters", "Questions"}


def recompute_language(db: Session, language_id: str) -> DagReport:
    """Ricalcola da capo tutti i valori di una lingua.

    Passo 1: dalle risposte al valore grezzo di ogni parametro attivo.
    Passo 2: dalle condizioni al valore finale.
    Va usata dopo ogni modifica in blocco di risposte, domande o parametri
    (import, restore): col solo passo 2 i valori grezzi resterebbero vecchi o
    vuoti, e quelli finali sbagliati. Il commit lo fa chi chiama.
    """
    param_ids = [
        pid for (pid,) in
        db.query(models.ParameterDef.id).filter(models.ParameterDef.is_active == True).all()
    ]
    for pid in param_ids:
        recompute_and_persist_language_parameter(language_id, pid, db)
    return run_dag_for_language(language_id, db)


def recompute_all_languages(
    on_language: Optional[Callable[[int, int, str], None]] = None,
) -> List[dict]:
    """Ricalcola tutte le lingue, una alla volta e ognuna nella sua transazione.

    `on_language(posizione, totale, id)` serve a mostrare l'avanzamento.
    Ritorna le lingue non riuscite: [{"language_id", "reason"}].
    """
    list_db = SessionLocal()
    try:
        language_ids = [
            r[0] for r in
            list_db.query(models.Language.id).order_by(func.lower(models.Language.id)).all()
        ]
    finally:
        list_db.close()

    errors: List[dict] = []
    total = len(language_ids)
    for position, lang_id in enumerate(language_ids, start=1):
        if on_language:
            on_language(position, total, lang_id)
        db = SessionLocal()
        try:
            recompute_language(db, lang_id)
            db.commit()
        except Exception as e:
            db.rollback()
            logger.error("Recompute failed for language %s: %s", lang_id, e, exc_info=True)
            errors.append({"language_id": lang_id, "reason": str(e)[:300]})
        finally:
            db.close()
    return errors


def recompute_after_excel_import(
    db: Session, report: ImportReport, background_tasks: BackgroundTasks,
) -> Optional[str]:
    """Dopo un import Excel: i valori non stanno nel file, vanno rifatti dalle risposte.

    Parametri o domande importati -> tutte le lingue, dopo la risposta.
    Risposte di una lingua -> subito quella lingua.
    """
    if SCHEMA_SHEETS & set(report.sheets_processed):
        background_tasks.add_task(recompute_all_languages)
        return "all_languages_started"
    if report.target_language_id:
        try:
            recompute_language(db, report.target_language_id)
            db.commit()
            return "language_done"
        except Exception as e:
            db.rollback()
            logger.error("Recompute after import failed for %s: %s", report.target_language_id, e, exc_info=True)
            report.errors.append(ImportRowError(
                sheet="(recompute)", row=0,
                reason=f"Data imported, but the parameter values could not be recomputed: {e}",
            ))
    return None


def recompute_parameter_for_all_languages(parameter_id: str) -> None:
    """Dopo la modifica di un parametro: il suo valore grezzo e i valori finali, per tutte le lingue."""
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
