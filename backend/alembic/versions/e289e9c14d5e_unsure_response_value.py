"""add 'unsure' value to answers.response_text enum

Estende l'enum `response_types` con il valore 'unsure'. La risposta 'unsure'
si comporta come 'yes' solo per il vincolo "minimo 2 esempi"; per tutto il
resto (consolidate, DAG, parser logico, contatore di risposte completate)
viene trattata come una non-risposta. Vedere
backend/routers/compilation.py e backend/services/param_consolidate.py.

Revision ID: e289e9c14d5e
Revises: c4f8a17b9d20
Create Date: 2026-04-30 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'e289e9c14d5e'
down_revision: Union[str, Sequence[str], None] = 'c4f8a17b9d20'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Postgres 12+: ALTER TYPE ADD VALUE puo' girare in transazione, ma per
    # robustezza usiamo autocommit_block (alcuni setup pre-12 lo richiedono).
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE response_types ADD VALUE IF NOT EXISTS 'unsure'")


def downgrade() -> None:
    # Postgres non supporta la rimozione di un valore da un enum esistente:
    # ricreiamo il tipo da zero. Eventuali righe con 'unsure' vengono prima
    # convertite a NULL (semanticamente "non risposta", coerente col
    # comportamento dell'app).
    op.execute("UPDATE answers SET response_text = NULL WHERE response_text = 'unsure'")
    op.execute("ALTER TYPE response_types RENAME TO response_types_old")
    op.execute("CREATE TYPE response_types AS ENUM ('yes', 'no')")
    op.execute(
        "ALTER TABLE answers "
        "ALTER COLUMN response_text TYPE response_types "
        "USING response_text::text::response_types"
    )
    op.execute("DROP TYPE response_types_old")
