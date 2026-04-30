"""
Migration Bundle Importer — endpoint admin one-shot.

POST /api/admin/migration/import-bundle?wipe=true
    multipart/form-data con il file ZIP prodotto dal sito vecchio.
    Ritorna immediatamente {"job_id": "..."} e lancia l'import come
    BackgroundTask. Polla GET /status/{job_id} per seguire l'avanzamento.

GET /api/admin/migration/status/{job_id}
    Stato corrente del job: phase, label, current/total, finished, error,
    report (popolato a fine job).

Attenzione: con wipe=true vengono troncate tutte le tabelle dati. È pensato
come operazione una-tantum di seed alla messa online del nuovo sito. Disabilitare
o nascondere il bottone in produzione una volta completata la migrazione.
"""
from __future__ import annotations
import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File

import models
from database import SessionLocal
from dependencies import require_admin
from services import migration_progress
from services.migration_import import import_migration_bundle
from services.migration_progress import ProgressReporter


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin/migration", tags=["Migration"])


# Limite di sicurezza: 200 MB per il bundle
MAX_BUNDLE_SIZE = 200 * 1024 * 1024


def _run_import_in_background(contents: bytes, wipe: bool, job_id: str) -> None:
    """Eseguito dal threadpool di BackgroundTasks. Apre la propria DB session
    perché quella iniettata via Depends() viene chiusa al ritorno della response."""
    db = SessionLocal()
    try:
        reporter = ProgressReporter(job_id)
        report = import_migration_bundle(db, contents, wipe=wipe, progress=reporter)
        migration_progress.finish_ok(job_id, report.to_dict())
    except Exception as e:
        logger.exception("Migration import job %s failed", job_id)
        migration_progress.finish_error(job_id, f"Unexpected error: {e}")
    finally:
        db.close()


@router.post("/import-bundle")
async def post_import_migration_bundle(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    wipe: bool = True,
    current_user: models.User = Depends(require_admin),
):
    fname = (file.filename or "").lower()
    if not fname.endswith(".zip"):
        raise HTTPException(status_code=400, detail="Upload a .zip file")

    try:
        contents = await file.read()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read the file: {e}")

    if len(contents) == 0:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(contents) > MAX_BUNDLE_SIZE:
        raise HTTPException(status_code=413, detail="Bundle too large (max 200 MB)")

    job_id = migration_progress.new_job()
    background_tasks.add_task(_run_import_in_background, contents, wipe, job_id)
    return {"job_id": job_id}


@router.get("/status/{job_id}")
def get_migration_status(
    job_id: str,
    current_user: models.User = Depends(require_admin),
):
    state = migration_progress.get_state(job_id)
    if state is None:
        raise HTTPException(status_code=404, detail="Job not found or expired")
    return state
