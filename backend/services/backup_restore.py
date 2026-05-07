"""
Backup Restore: importa un bundle ZIP prodotto da `build_backup_zip_bytes`.

Bundle atteso (vedi `services.excel_export.build_backup_zip_bytes`):

    PCM_backup_<ts>.zip
    ├── schema.xlsx              (4 sheet: Motivations, Parameters, Questions, QAM)
    ├── languages_metadata.xlsx  (1 sheet: Languages)
    ├── glossary.xlsx            (1 sheet: Glossary)
    └── languages/
        ├── <ID>.xlsx            (Database_model esteso, Answers, Examples, Admin Notes)
        └── ...

Strategia (sempre upsert, mai delete):
  1. schema.xlsx          -> upsert Motivations / Parameters / Questions / QAM
  2. languages_metadata   -> upsert Language per ID (creando o aggiornando metadata)
  3. glossary.xlsx        -> upsert Glossary per word
  4. languages/<id>.xlsx  -> REPLACE compilazione (Answer/Example/AnswerMotivation)
                            + ripristino admin_note per (lang, param)

Le entità non menzionate restano in DB (no delete). Per un wipe-and-restore
totale usare `wipe=True`: tronca le tabelle dati prima di importare. Gli utenti
non vengono toccati.

Fasi tracciate via `services.migration_progress` (riusato — stesso pattern dei
job di Migration Import). Ogni xlsx del bundle è una "tick" individuale per la
fase di compilation; le altre fasi sono single-tick.

Endpoint chiamante: routers/backup.py
"""
from __future__ import annotations
from dataclasses import dataclass, field, asdict
from typing import List, Optional, Dict, Any
import io
import os
import zipfile

from sqlalchemy.orm import Session

import models
from services.excel_import import import_excel, ImportReport
from services.migration_progress import ProgressReporter, NULL_PROGRESS


# ============================================================================
# Report
# ============================================================================

@dataclass
class BackupRestoreReport:
    files_processed: List[str] = field(default_factory=list)
    files_skipped: List[str] = field(default_factory=list)
    errors: List[Dict[str, Any]] = field(default_factory=list)
    by_file: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    languages_restored: List[str] = field(default_factory=list)
    languages_failed: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "files_processed": self.files_processed,
            "files_skipped": self.files_skipped,
            "errors": self.errors,
            "by_file": self.by_file,
            "languages_restored": self.languages_restored,
            "languages_failed": self.languages_failed,
            "total_errors": len(self.errors),
        }


def _absorb_sub_report(report: BackupRestoreReport, file_name: str, sub: ImportReport) -> None:
    """Copia gli errori e summary di una `import_excel` interna nel report globale."""
    report.files_processed.append(file_name)
    report.by_file[file_name] = {
        "sheets_processed": sub.sheets_processed,
        "by_sheet": {k: v.to_dict() for k, v in sub.by_sheet.items()},
        "errors_count": len(sub.errors),
    }
    for e in sub.errors:
        d = e.to_dict()
        d["_file"] = file_name
        report.errors.append(d)


# ============================================================================
# Wipe (operazione facoltativa, distruttiva)
# ============================================================================

# Stesse tabelle wipate da migration_import.import_migration_bundle (in ordine
# FK-safe). Le copio qui perché backup_restore non vuole dipendere dall'altro
# servizio: condividono solo lo schema dati.
_WIPE_TABLES_FK_SAFE = [
    "answer_motivations",
    "examples",
    "answers",
    "language_parameter_evals",
    "language_parameters",
    "language_parameter_statuses",
    "submission_answer_motivations",
    "submission_examples",
    "submission_params",
    "submission_answers",
    "submissions",
    "question_allowed_motivations",
    "questions",
    "parameter_change_logs",
    "parameter_defs",
    "motivations",
    "languages",
    "groups",
    "families",
    "top_families",
    "glossary",
]


def _wipe_data(db: Session) -> None:
    from sqlalchemy import text
    for tbl in _WIPE_TABLES_FK_SAFE:
        try:
            db.execute(text(f"DELETE FROM {tbl}"))
        except Exception:
            # Tabella inesistente nel DB corrente: skip senza errore
            db.rollback()
    db.commit()


# ============================================================================
# Entry point
# ============================================================================

SCHEMA_FILE = "schema.xlsx"
METADATA_FILE = "languages_metadata.xlsx"
GLOSSARY_FILE = "glossary.xlsx"
LANG_DIR = "languages/"


def restore_backup_bundle(
    db: Session,
    zip_bytes: bytes,
    current_user_id: int,
    *,
    wipe: bool = False,
    progress: ProgressReporter = NULL_PROGRESS,
) -> BackupRestoreReport:
    report = BackupRestoreReport()

    try:
        zf = zipfile.ZipFile(io.BytesIO(zip_bytes), "r")
    except zipfile.BadZipFile as e:
        report.errors.append({"_file": "(bundle)", "reason": f"Not a valid ZIP file: {e}"})
        return report

    namelist = zf.namelist()

    if wipe:
        progress.phase("wipe", "Wiping data tables…", total=1)
        try:
            _wipe_data(db)
            progress.tick(1)
        except Exception as e:
            report.errors.append({"_file": "(wipe)", "reason": f"Wipe failed: {e}"})
            return report

    # 1. Schema (richiesto)
    if SCHEMA_FILE in namelist:
        progress.phase("schema", "Importing schema…", total=1)
        with zf.open(SCHEMA_FILE) as f:
            sub = import_excel(db, f.read(), current_user_id, create_missing=True)
        _absorb_sub_report(report, SCHEMA_FILE, sub)
        progress.tick(1)
    else:
        report.errors.append({"_file": SCHEMA_FILE, "reason": "Missing schema.xlsx in bundle"})

    # 2. Languages metadata
    if METADATA_FILE in namelist:
        progress.phase("metadata", "Importing languages metadata…", total=1)
        with zf.open(METADATA_FILE) as f:
            sub = import_excel(db, f.read(), current_user_id, create_missing=True)
        _absorb_sub_report(report, METADATA_FILE, sub)
        progress.tick(1)
    else:
        report.files_skipped.append(METADATA_FILE)

    # 3. Glossary
    if GLOSSARY_FILE in namelist:
        progress.phase("glossary", "Importing glossary…", total=1)
        with zf.open(GLOSSARY_FILE) as f:
            sub = import_excel(db, f.read(), current_user_id, create_missing=True)
        _absorb_sub_report(report, GLOSSARY_FILE, sub)
        progress.tick(1)
    else:
        report.files_skipped.append(GLOSSARY_FILE)

    # 4. Per-language compilation
    lang_files = sorted(
        n for n in namelist
        if n.startswith(LANG_DIR) and n.endswith(".xlsx") and not n.endswith("/")
    )
    total = len(lang_files)
    progress.phase("compilation", f"Restoring {total} language(s)…", total=total)
    for i, name in enumerate(lang_files, start=1):
        lang_id = os.path.splitext(os.path.basename(name))[0]
        progress.tick(current=i, label=f"Restoring {lang_id} ({i}/{total})")
        try:
            with zf.open(name) as f:
                sub = import_excel(db, f.read(), current_user_id, create_missing=True)
        except Exception as e:
            report.errors.append({"_file": name, "reason": f"Cannot read entry: {e}"})
            report.languages_failed.append(lang_id)
            continue
        _absorb_sub_report(report, name, sub)
        if sub.errors:
            report.languages_failed.append(lang_id)
        else:
            report.languages_restored.append(lang_id)

    return report
