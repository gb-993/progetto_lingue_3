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
import io
import logging
import zipfile

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File

import models
from database import SessionLocal
from dependencies import require_super_admin
from services import migration_progress
from services.migration_import import import_migration_bundle
from services.migration_progress import ProgressReporter


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin/migration", tags=["Migration"])


# Limite di sicurezza per il bundle compresso e per la sua decompressione.
# Il check sul decompresso evita zip-bomb (file piccolo, dati enormi).
MAX_BUNDLE_SIZE = 200 * 1024 * 1024            # 200 MB compresso
MAX_UNCOMPRESSED_TOTAL = 500 * 1024 * 1024     # 500 MB decompresso totale
MAX_UNCOMPRESSED_PER_FILE = 100 * 1024 * 1024  # 100 MB per singolo file


def _validate_zip_bundle(contents: bytes) -> None:
    """
    Apre il bundle in lettura SOLO per validarne i metadati (namelist + sizes)
    senza estrarre nulla, e solleva HTTPException 400/413 se trova qualcosa
    di sospetto. Chi chiama deve aver gia' verificato la dimensione totale
    del file caricato.

    Difese:
      - path-traversal: rifiuta nomi assoluti, contenenti ".." o backslash
      - directory escape: rifiuta nomi con drive Windows (es. "C:\\...")
      - zip-bomb: rifiuta se un singolo file supera MAX_UNCOMPRESSED_PER_FILE
        o se la somma di tutti i file decompressi supera MAX_UNCOMPRESSED_TOTAL
    """
    try:
        zf = zipfile.ZipFile(io.BytesIO(contents), "r")
    except zipfile.BadZipFile as e:
        raise HTTPException(status_code=400, detail=f"Not a valid ZIP file: {e}")

    total_uncompressed = 0
    for info in zf.infolist():
        name = info.filename

        # Path-traversal: il bundle del nostro vecchio sito ha solo
        # filename "piatti" tipo "01_motivations.xlsx", senza directory.
        # Qualsiasi cosa di diverso e' sospetta.
        if (
            name.startswith("/")
            or name.startswith("\\")
            or ".." in name.replace("\\", "/").split("/")
            or (len(name) >= 2 and name[1] == ":")  # "C:..." su Windows
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

    # Validazione metadati zip prima di lanciare il job: blocca path
    # traversal e zip-bomb. Solleva HTTPException se qualcosa non torna.
    _validate_zip_bundle(contents)

    job_id = migration_progress.new_job()
    background_tasks.add_task(_run_import_in_background, contents, wipe, job_id)
    return {"job_id": job_id}


@router.get("/status/{job_id}")
def get_migration_status(
    job_id: str,
    current_user: models.User = Depends(require_super_admin),
):
    state = migration_progress.get_state(job_id)
    if state is None:
        raise HTTPException(status_code=404, detail="Job not found or expired")
    return state
