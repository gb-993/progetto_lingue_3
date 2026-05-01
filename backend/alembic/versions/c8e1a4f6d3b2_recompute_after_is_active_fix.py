"""recompute language parameters after question is_active fix

Dopo il fix che fa rispettare `Question.is_active` nel calcolo del valore del
parametro (services/param_consolidate.py) e quindi a cascata nel DAG,
i `LanguageParameter.value_orig` / `LanguageParameterEval.value_eval` gia'
salvati possono essere stale: erano stati calcolati includendo le risposte di
question disattivate. Questa migration ricalcola una volta sola tutti i
parametri per tutte le lingue.

Idempotente per costruzione (Alembic non riesegue una revision gia' applicata).
Se una lingua/parametro fallisce in modo eccezionale la migration esce con
errore e viene fatto rollback dell'intera transazione: l'admin vede il problema
e puo' rieseguire dopo il fix.

Revision ID: c8e1a4f6d3b2
Revises: e289e9c14d5e
Create Date: 2026-05-01 00:00:00.000000

"""
import logging
from typing import Sequence, Union

from alembic import op
from sqlalchemy.orm import Session


revision: str = 'c8e1a4f6d3b2'
down_revision: Union[str, Sequence[str], None] = 'e289e9c14d5e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

logger = logging.getLogger("alembic.runtime.migration")


def upgrade() -> None:
    # Import dentro la funzione: il file di revision viene caricato anche da
    # `alembic history`, e in quel contesto importare i service applicativi
    # potrebbe rompersi se l'env non e' completamente configurato.
    import models
    from services.param_consolidate import recompute_and_persist_language_parameter
    from services.dag_eval import run_dag_for_language

    bind = op.get_bind()
    session = Session(bind=bind)
    try:
        language_ids = [r[0] for r in session.query(models.Language.id).all()]
        active_param_ids = [
            r[0] for r in session.query(models.ParameterDef.id).filter(
                models.ParameterDef.is_active == True
            ).all()
        ]

        if not language_ids or not active_param_ids:
            logger.info("recompute migration: nothing to do (no languages or no active parameters).")
            return

        logger.info(
            "recompute migration: %d languages x %d active parameters",
            len(language_ids), len(active_param_ids),
        )

        for lang_id in language_ids:
            for pid in active_param_ids:
                recompute_and_persist_language_parameter(lang_id, pid, session)
            run_dag_for_language(lang_id, session)
            session.flush()

        logger.info("recompute migration: completed for %d languages.", len(language_ids))
    finally:
        session.close()


def downgrade() -> None:
    # Data-only migration: il downgrade non ha azioni reversibili sensate.
    # I valori ricalcolati sono semanticamente piu' corretti dei precedenti,
    # quindi non li ripristiniamo allo stato stale.
    pass
