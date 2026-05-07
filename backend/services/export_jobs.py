"""
Tracking di job asincroni per export pesanti (es. backup zip).

Riusa `migration_progress` per la parte di stato (phase, current/total, finished,
error) e aggiunge:
  - un path tmp dedicato per ciascun job (`<EXPORT_DIR>/<job_id>.zip`)
  - tracking in-memory job_id -> path
  - helper `consume_file` per il download one-shot
  - `cleanup_file` da invocare via BackgroundTasks dopo l'invio della response

Storage in-memory: adeguato per single-process (uvicorn --workers=1, default in
dev/staging). In produzione multi-worker servirebbe Redis/DB condiviso.

Cleanup: i file orfani (job mai scaricato) restano fino al purge TTL del job in
`migration_progress` (1h). Per non lasciarli in /tmp anche dopo il purge,
chiamiamo cleanup_file() in `finish_error`. Nel caso "successo + non scaricato",
il file vivrà finché qualcuno non avvia un nuovo job_id che gestisca il cleanup
periodico — accettabile su singolo box.
"""
from __future__ import annotations
import os
import threading
import tempfile
from typing import Optional

from services import migration_progress


_LOCK = threading.Lock()
_FILES: dict[str, str] = {}  # job_id -> path al file zip pronto

EXPORT_DIR = os.path.join(tempfile.gettempdir(), "pcm_exports")
os.makedirs(EXPORT_DIR, exist_ok=True)


def new_job() -> str:
    """Crea un job_id (riusa migration_progress.new_job)."""
    return migration_progress.new_job()


def get_target_path(job_id: str) -> str:
    """Calcola il path tmp dove l'export salverà il proprio zip."""
    return os.path.join(EXPORT_DIR, f"{job_id}.zip")


def set_phase(job_id: str, phase: str, label: str = "", total: int = 0) -> None:
    migration_progress.set_phase(job_id, phase, label=label, total=total)


def tick(job_id: str, current: Optional[int] = None, label: Optional[str] = None) -> None:
    migration_progress.tick(job_id, current=current, label=label)


def set_file_ready(job_id: str, path: str) -> None:
    """Registra il file pronto e segna il job come completato."""
    with _LOCK:
        _FILES[job_id] = path
    migration_progress.finish_ok(job_id, {
        "file_ready": True,
        "size_bytes": os.path.getsize(path) if os.path.exists(path) else None,
    })


def finish_error(job_id: str, error: str) -> None:
    """Segna errore + elimina file parziale se esiste."""
    migration_progress.finish_error(job_id, error)
    target = get_target_path(job_id)
    cleanup_file(target)
    with _LOCK:
        _FILES.pop(job_id, None)


def get_state(job_id: str):
    return migration_progress.get_state(job_id)


def consume_file(job_id: str) -> Optional[str]:
    """Restituisce il path e lo rimuove dal tracking (download one-shot).
    Il file fisico va cancellato dal chiamante (via BackgroundTasks)."""
    with _LOCK:
        return _FILES.pop(job_id, None)


def cleanup_file(path: str) -> None:
    """Idempotente: elimina il file dato se esiste, ignora errori OS."""
    if path and os.path.exists(path):
        try:
            os.remove(path)
        except OSError:
            pass
