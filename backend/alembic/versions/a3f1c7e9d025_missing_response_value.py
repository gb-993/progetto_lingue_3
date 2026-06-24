"""add 'missing' value to answers.response_text enum

Estende l'enum `response_types` con il valore 'missing'. La risposta 'missing'
si comporta ESATTAMENTE come 'unsure' (vedi e289e9c14d5e) — viene trattata come
una non-risposta da consolidate, DAG, parser logico e contatore di risposte
completate, quindi NON tocca il calcolo dei valori — con l'unica differenza che
NON richiede esempi (dato genuinamente non disponibile). Vedere
backend/routers/compilation.py.

Revision ID: a3f1c7e9d025
Revises: d2e4f6a8b013
Create Date: 2026-06-24 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'a3f1c7e9d025'
down_revision: Union[str, Sequence[str], None] = 'd2e4f6a8b013'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Postgres 12+: ALTER TYPE ADD VALUE puo' girare in transazione, ma per
    # robustezza usiamo autocommit_block (alcuni setup pre-12 lo richiedono).
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE response_types ADD VALUE IF NOT EXISTS 'missing'")


def downgrade() -> None:
    # Postgres non supporta la rimozione di un valore da un enum esistente:
    # ricreiamo il tipo da zero. Eventuali righe con 'missing' vengono prima
    # convertite a NULL (semanticamente "non risposta", coerente col
    # comportamento dell'app).
    op.execute("UPDATE answers SET response_text = NULL WHERE response_text = 'missing'")
    op.execute("ALTER TYPE response_types RENAME TO response_types_old")
    op.execute("CREATE TYPE response_types AS ENUM ('yes', 'no', 'unsure')")
    op.execute(
        "ALTER TABLE answers "
        "ALTER COLUMN response_text TYPE response_types "
        "USING response_text::text::response_types"
    )
    op.execute("DROP TYPE response_types_old")
