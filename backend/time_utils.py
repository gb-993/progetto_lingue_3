"""
Helper per timestamp UTC.

`datetime.utcnow()` è deprecato da Python 3.12 e ritorna un naive datetime
senza tzinfo. Per evitare ambiguità (e il warning) usiamo questa funzione
ovunque nel codice applicativo: ritorna sempre un naive datetime ma
calcolato esplicitamente in UTC, indipendentemente dal TZ del container.

Quando vorremo passare a TIMESTAMPTZ in DB, basterà cambiare qui il
return type a `datetime.now(timezone.utc)` (aware) e migrare le colonne.
Le migrations Alembic storiche NON vanno toccate: usano `datetime.utcnow`
e devono restare congelate per riproducibilità.
"""
from datetime import datetime, timezone

__all__ = ["utc_now"]


def utc_now() -> datetime:
    """Naive datetime in UTC, lock-ato a UTC anche se il TZ del container cambia."""
    return datetime.now(timezone.utc).replace(tzinfo=None)
