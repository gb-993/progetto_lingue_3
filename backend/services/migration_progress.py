"""
Tracking in-memory dello stato di avanzamento dei job di migration import.

Usato da `migration_import.import_migration_bundle` per pubblicare la fase
corrente, e dall'endpoint `GET /api/admin/migration/status/{job_id}` per
mostrare al client la progressione.

Storage: dict modulo-livello protetto da Lock. Adeguato per single-process
(uvicorn --workers=1, default in dev/staging). In produzione multi-worker
servirebbe un backend condiviso (Redis/DB).

I job completati vengono purgati automaticamente dopo 1h dal termine.
"""
from __future__ import annotations
import threading
import time
import uuid
from typing import Optional, Dict, Any


_LOCK = threading.Lock()
_JOBS: Dict[str, Dict[str, Any]] = {}
_TTL_SECONDS = 3600  # 1h


def new_job() -> str:
    """Crea un nuovo job_id e ne registra lo stato iniziale."""
    job_id = str(uuid.uuid4())
    with _LOCK:
        _JOBS[job_id] = {
            "job_id": job_id,
            "started_at": time.time(),
            "finished_at": None,
            "phase": "queued",
            "phase_label": "Job queued",
            "current": 0,
            "total": 0,
            "finished": False,
            "error": None,
            "report": None,
        }
    _purge_expired_locked_free()
    return job_id


def set_phase(job_id: str, phase: str, label: str = "", total: int = 0) -> None:
    """Inizia una nuova fase. Resetta `current` a 0."""
    with _LOCK:
        j = _JOBS.get(job_id)
        if not j or j.get("finished"):
            return
        j["phase"] = phase
        j["phase_label"] = label or phase
        j["current"] = 0
        j["total"] = total


def tick(job_id: str, current: Optional[int] = None, label: Optional[str] = None) -> None:
    """Avanza il contatore della fase corrente. Senza `current` incrementa di 1.
    `label` aggiorna l'etichetta dettaglio (es. lingua corrente)."""
    with _LOCK:
        j = _JOBS.get(job_id)
        if not j or j.get("finished"):
            return
        if current is not None:
            j["current"] = current
        else:
            j["current"] = (j.get("current") or 0) + 1
        if label is not None:
            j["phase_label"] = label


def finish_ok(job_id: str, report: Any) -> None:
    """Segna il job come completato con successo. `report` è il dict serializzato."""
    with _LOCK:
        j = _JOBS.get(job_id)
        if not j:
            return
        j["finished"] = True
        j["finished_at"] = time.time()
        j["report"] = report
        j["phase"] = "done"
        j["phase_label"] = "Completed"


def finish_error(job_id: str, error: str) -> None:
    """Segna il job come terminato con errore."""
    with _LOCK:
        j = _JOBS.get(job_id)
        if not j:
            return
        j["finished"] = True
        j["finished_at"] = time.time()
        j["error"] = error
        j["phase"] = "error"
        j["phase_label"] = "Failed"


def get_state(job_id: str) -> Optional[Dict[str, Any]]:
    """Ritorna una copia dello stato del job, o None se non esiste."""
    with _LOCK:
        j = _JOBS.get(job_id)
        if j is None:
            return None
        return dict(j)


def _purge_expired_locked_free() -> None:
    """Rimuove job terminati da più di TTL_SECONDS. Non chiamare con _LOCK già preso."""
    now = time.time()
    with _LOCK:
        to_del = [
            k for k, v in _JOBS.items()
            if v.get("finished") and v.get("finished_at")
            and now - v["finished_at"] > _TTL_SECONDS
        ]
        for k in to_del:
            del _JOBS[k]


# ============================================================================
# Reporter helper: oggetto passato a import_migration_bundle che incapsula
# il job_id. Comodo perché il chiamante non deve ripassarlo a ogni call.
# ============================================================================

class ProgressReporter:
    """Wrapper object che lega un job_id alle funzioni di progresso.

    Si comporta come no-op se `job_id` è None — utile per i test e per
    invocazioni dirette (es. da CLI) che non hanno un job tracking attivo.
    """
    def __init__(self, job_id: Optional[str]):
        self.job_id = job_id

    def phase(self, phase: str, label: str = "", total: int = 0) -> None:
        if self.job_id is None:
            return
        set_phase(self.job_id, phase, label=label, total=total)

    def tick(self, current: Optional[int] = None, label: Optional[str] = None) -> None:
        if self.job_id is None:
            return
        tick(self.job_id, current=current, label=label)


NULL_PROGRESS = ProgressReporter(None)
