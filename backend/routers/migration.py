"""
Migration Bundle Importer — endpoint admin one-shot.

POST /api/admin/migration/import-bundle?wipe=true
    multipart/form-data con il file ZIP prodotto dal sito vecchio.
    Ritorna un MigrationReport JSON.

Attenzione: con wipe=true vengono troncate tutte le tabelle dati. È pensato
come operazione una-tantum di seed alla messa online del nuovo sito. Disabilitare
o nascondere il bottone in produzione una volta completata la migrazione.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

import models
from dependencies import get_db, require_admin
from services.migration_import import import_migration_bundle


router = APIRouter(prefix="/api/admin/migration", tags=["Migration"])


# Limite di sicurezza: 200 MB per il bundle
MAX_BUNDLE_SIZE = 200 * 1024 * 1024


@router.post("/import-bundle")
def post_import_migration_bundle(
    file: UploadFile = File(...),
    wipe: bool = True,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    fname = (file.filename or "").lower()
    if not fname.endswith(".zip"):
        raise HTTPException(status_code=400, detail="Upload a .zip file")

    try:
        contents = file.file.read()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read the file: {e}")

    if len(contents) == 0:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(contents) > MAX_BUNDLE_SIZE:
        raise HTTPException(status_code=413, detail="Bundle too large (max 200 MB)")

    report = import_migration_bundle(db, contents, wipe=wipe)
    return report.to_dict()
