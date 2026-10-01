"""Job di export (es. backup zip) e pulizia dei file."""

from __future__ import annotations
import os
import time
import threading
import tempfile
from typing import Optional

from services import migration_progress


_LOCK = threading.Lock()
_FILE_PATHS_BY_JOB_ID: dict[str, str] = {}

EXPORT_DIR = os.path.join(tempfile.gettempdir(), "pcm_exports")
os.makedirs(EXPORT_DIR, exist_ok=True)

ORPHAN_TTL_SECONDS = 2 * 60 * 60


def cleanup_stale_files(max_age_seconds: int = ORPHAN_TTL_SECONDS) -> int:
    """Cancella i file di export più vecchi di `max_age_seconds`."""
    now = time.time()
    removed = 0
    try:
        entries = os.listdir(EXPORT_DIR)
    except OSError:
        return 0
    for filename in entries:
        path = os.path.join(EXPORT_DIR, filename)
        try:
            if not os.path.isfile(path):
                continue
            if now - os.path.getmtime(path) >= max_age_seconds:
                os.remove(path)
                removed += 1
        except OSError:
            pass
    return removed


def new_job() -> str:
    """Nuovo job_id; intanto pulisce gli zip orfani."""
    cleanup_stale_files()
    return migration_progress.new_job()


def get_target_path(job_id: str) -> str:
    return os.path.join(EXPORT_DIR, f"{job_id}.zip")


def set_phase(job_id: str, phase: str, label: str = "", total: int = 0) -> None:
    migration_progress.set_phase(job_id, phase, label=label, total=total)


def tick(job_id: str, current: Optional[int] = None, label: Optional[str] = None) -> None:
    migration_progress.tick(job_id, current=current, label=label)


def set_file_ready(job_id: str, path: str) -> None:
    with _LOCK:
        _FILE_PATHS_BY_JOB_ID[job_id] = path
    migration_progress.finish_ok(job_id, {
        "file_ready": True,
        "size_bytes": os.path.getsize(path) if os.path.exists(path) else None,
    })


def finish_error(job_id: str, error: str) -> None:
    """Segna errore e cancella il file parziale."""
    migration_progress.finish_error(job_id, error)
    target_path = get_target_path(job_id)
    cleanup_file(target_path)
    with _LOCK:
        _FILE_PATHS_BY_JOB_ID.pop(job_id, None)


def get_state(job_id: str):
    return migration_progress.get_state(job_id)


def consume_file(job_id: str) -> Optional[str]:
    """Download una volta sola; il file lo cancella il chiamante."""
    with _LOCK:
        return _FILE_PATHS_BY_JOB_ID.pop(job_id, None)


def cleanup_file(path: str) -> None:
    """Cancella il file se c'è, ignora errori."""
    if path and os.path.exists(path):
        try:
            os.remove(path)
        except OSError:
            pass
