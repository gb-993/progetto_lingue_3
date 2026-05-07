"""
Recompute endpoints (admin only).

POST /api/admin/recompute/all
    Avvia il ricalcolo dei final values (DAG + consolidate) su TUTTE le lingue.
    Ritorna {"job_id": "..."} subito; il lavoro vero gira in background.

GET /api/admin/recompute/status/{job_id}
    Stato corrente del job: phase, current/total, finished, error.

Riusa l'infrastruttura `migration_progress` per il tracking progresso.
"""
from __future__ import annotations
import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

import models
from database import SessionLocal
from dependencies import require_admin
from services import migration_progress
from services.dag_eval import run_dag_for_language


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin/recompute", tags=["Recompute"])


def _run_recompute_all_in_background(job_id: str) -> None:
    """Loop su tutte le lingue, esegue run_dag_for_language per ciascuna.
    Ogni lingua ha la propria sessione: errore su una non blocca le altre."""
    list_db = SessionLocal()
    try:
        lang_ids = [
            l.id for l in
            list_db.query(models.Language.id).order_by(models.Language.position, models.Language.id).all()
        ]
    finally:
        list_db.close()

    total = len(lang_ids)
    if total == 0:
        migration_progress.finish_ok(job_id, {"languages_processed": 0, "errors": []})
        return

    migration_progress.set_phase(job_id, "recompute", "Recomputing final values…", total=total)

    errors = []
    for i, lang_id in enumerate(lang_ids, start=1):
        migration_progress.tick(job_id, current=i, label=f"Recomputing {lang_id} ({i}/{total})")
        db = SessionLocal()
        try:
            run_dag_for_language(lang_id, db)
            db.commit()
        except Exception as e:
            db.rollback()
            logger.error("Recompute failed for language %s: %s", lang_id, e, exc_info=True)
            errors.append({"language_id": lang_id, "reason": str(e)[:300]})
        finally:
            db.close()

    migration_progress.finish_ok(job_id, {
        "languages_processed": total,
        "errors": errors,
        "errors_count": len(errors),
    })


@router.post("/all")
def start_recompute_all(
    background_tasks: BackgroundTasks,
    current_user: models.User = Depends(require_admin),
):
    job_id = migration_progress.new_job()
    background_tasks.add_task(_run_recompute_all_in_background, job_id)
    return {"job_id": job_id}


@router.get("/status/{job_id}")
def get_recompute_status(
    job_id: str,
    current_user: models.User = Depends(require_admin),
):
    state = migration_progress.get_state(job_id)
    if state is None:
        raise HTTPException(status_code=404, detail="Job not found or expired")
    return state
