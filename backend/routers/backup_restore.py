"""
Backup Restore — endpoint admin.

POST /api/admin/backup-restore?wipe=true|false
    multipart/form-data con il file ZIP prodotto da `Export backup (.zip)`.
    Ritorna immediatamente {"job_id": "..."} e lancia l'import come BackgroundTask.
    Polla GET /api/admin/backup-restore/status/{job_id} per seguire l'avanzamento.

GET /api/admin/backup-restore/status/{job_id}
    Stato corrente del job: phase, label, current/total, finished, error,
    report (popolato a fine job).

A differenza di Migration Import (one-shot al go-live), il Backup Restore è
ricorrente: serve a ripristinare i dati dopo un export. Riusa la stessa
infrastruttura `migration_progress` per il progress reporting.
"""
from __future__ import annotations
import logging
import zipfile
import io

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File

import models
from database import SessionLocal
from dependencies import require_super_admin
from services import migration_progress
from services.backup_restore import restore_backup_bundle
from services.migration_progress import ProgressReporter


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin/backup-restore", tags=["BackupRestore"])


# Stessi limiti del migration import per coerenza.
MAX_BUNDLE_SIZE = 200 * 1024 * 1024            # 200 MB compresso
MAX_UNCOMPRESSED_TOTAL = 500 * 1024 * 1024     # 500 MB decompresso totale
MAX_UNCOMPRESSED_PER_FILE = 100 * 1024 * 1024  # 100 MB per singolo file


def _validate_zip_bundle(contents: bytes) -> None:
    """Validazione metadati zip: blocca path-traversal, drive letters e
    zip-bomb. Ricalca routers/migration.py."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(contents), "r")
    except zipfile.BadZipFile as e:
        raise HTTPException(status_code=400, detail=f"Not a valid ZIP file: {e}")

    total_uncompressed = 0
    for info in zf.infolist():
        name = info.filename
        if (
            name.startswith("/")
            or name.startswith("\\")
            or ".." in name.replace("\\", "/").split("/")
            or (len(name) >= 2 and name[1] == ":")
        ):
            raise HTTPException(
                status_code=400,
                detail=f"Bundle contains an unsafe path: {name!r}",
            )
        if info.file_size > MAX_UNCOMPRESSED_PER_FILE:
            raise HTTPException(
                status_code=413,
                detail=(
                    f"Bundle entry too large when decompressed: {name!r} "
                    f"({info.file_size} > {MAX_UNCOMPRESSED_PER_FILE})"
                ),
            )
        total_uncompressed += info.file_size
        if total_uncompressed > MAX_UNCOMPRESSED_TOTAL:
            raise HTTPException(
                status_code=413,
                detail=(
                    f"Bundle decompressed total too large "
                    f"(> {MAX_UNCOMPRESSED_TOTAL} bytes)"
                ),
            )


def _run_restore_in_background(
    contents: bytes, wipe: bool, current_user_id: int, job_id: str
) -> None:
    """Esegue restore_backup_bundle col proprio session DB (quella iniettata
    via Depends() viene chiusa appena la response del start endpoint torna)."""
    db = SessionLocal()
    try:
        reporter = ProgressReporter(job_id)
        report = restore_backup_bundle(
            db, contents, current_user_id, wipe=wipe, progress=reporter,
        )
        migration_progress.finish_ok(job_id, report.to_dict())
    except Exception as e:
        logger.exception("Backup restore job %s failed", job_id)
        migration_progress.finish_error(job_id, f"Unexpected error: {e}")
    finally:
        db.close()


@router.post("")
async def post_backup_restore(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    wipe: bool = False,
    current_user: models.User = Depends(require_super_admin),
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

    _validate_zip_bundle(contents)

    job_id = migration_progress.new_job()
    background_tasks.add_task(
        _run_restore_in_background, contents, wipe, current_user.id, job_id
    )
    return {"job_id": job_id}


@router.get("/status/{job_id}")
def get_backup_restore_status(
    job_id: str,
    current_user: models.User = Depends(require_super_admin),
):
    state = migration_progress.get_state(job_id)
    if state is None:
        raise HTTPException(status_code=404, detail="Job not found or expired")
    return state
