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

Cleanup: tre livelli, così EXPORT_DIR non cresce mai senza limite (un ZIP non
ripulito può saturare il disco della VM):
  - download riuscito  -> cleanup_file() via BackgroundTasks dopo la response
  - job in errore      -> cleanup_file() in `finish_error`
  - "successo + non scaricato" (il caso insidioso): il file resta orfano perché
    nessuno dei due rami sopra scatta. Lo intercetta `cleanup_stale_files()`,
    invocata da `new_job()`: a ogni nuovo export rimuove gli ZIP più vecchi di
    ORPHAN_TTL_SECONDS (oltre il TTL del job non sono più scaricabili).
"""
from __future__ import annotations
import os
import time
import threading
import tempfile
from typing import Optional

from services import migration_progress


_LOCK = threading.Lock()
_FILES: dict[str, str] = {}  # job_id -> path al file zip pronto

EXPORT_DIR = os.path.join(tempfile.gettempdir(), "pcm_exports")
os.makedirs(EXPORT_DIR, exist_ok=True)

# TTL oltre il quale un file di export è considerato orfano e va rimosso.
# Lo stato del job viene purgato da migration_progress dopo 1h: oltre quella
# soglia il file non è più scaricabile (il download endpoint risponde 404),
# quindi è solo spazzatura su disco. 2h dà margine a un download lento in corso.
ORPHAN_TTL_SECONDS = 2 * 60 * 60


def cleanup_stale_files(max_age_seconds: int = ORPHAN_TTL_SECONDS) -> int:
    """Rimuove dagli export i file più vecchi di `max_age_seconds`.

    Serve a evitare che gli ZIP "generati ma mai scaricati" si accumulino in
    EXPORT_DIR all'infinito (cleanup_file scatta solo al download o su errore):
    senza questo, /tmp/pcm_exports cresce e può saturare il disco della VM.
    Best-effort e idempotente: ignora errori OS. Ritorna il numero di file
    rimossi. Filtra per mtime, quindi non tocca un file appena creato da un job
    in corso (età ~0)."""
    now = time.time()
    removed = 0
    try:
        entries = os.listdir(EXPORT_DIR)
    except OSError:
        return 0
    for name in entries:
        path = os.path.join(EXPORT_DIR, name)
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
    """Crea un job_id (riusa migration_progress.new_job).

    Ne approfittiamo per spazzare via gli ZIP di export orfani: ogni nuovo
    export tiene così pulito EXPORT_DIR senza bisogno di un cron dedicato."""
    cleanup_stale_files()
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
