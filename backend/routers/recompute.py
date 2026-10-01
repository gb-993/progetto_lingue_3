from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

import models
from database import SessionLocal
from dependencies import require_admin
from services import migration_progress
from services.dag_eval import formula_problems
from services.recompute import recompute_all_languages


router = APIRouter(prefix="/api/admin/recompute", tags=["Recompute"])


def _run_recompute_all_in_background(job_id: str) -> None:
    list_db = SessionLocal()
    try:
        total = list_db.query(models.Language).count()
        # uguali per tutte le lingue: quei parametri escono '?'
        formula_errors = formula_problems(list_db)
    finally:
        list_db.close()

    if total == 0:
        migration_progress.finish_ok(job_id, {"languages_processed": 0, "errors": [], "formula_errors": formula_errors})
        return

    migration_progress.set_phase(job_id, "recompute", "Recomputing final values…", total=total)

    errors = recompute_all_languages(
        on_language=lambda position, count, lang_id: migration_progress.tick(
            job_id, current=position, label=f"Recomputing {lang_id} ({position}/{count})"
        )
    )

    migration_progress.finish_ok(job_id, {
        "languages_processed": total,
        "errors": errors,
        "errors_count": len(errors),
        "formula_errors": formula_errors,
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
