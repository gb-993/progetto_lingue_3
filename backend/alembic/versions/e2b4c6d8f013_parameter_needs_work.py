"""parametri: sezioni segnate "da completare" (needs_work)

Elenco delle sezioni di un parametro che chi lo modifica ha segnato come ancora
da completare (es. ["long_description", "questions"]). Nella lista parametri
diventa il pallino giallo della colonna "To do". Le righe esistenti partono con
l'elenco vuoto.

Revision ID: e2b4c6d8f013
Revises: d1a3f5b7c902
Create Date: 2026-10-01 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e2b4c6d8f013'
down_revision: Union[str, Sequence[str], None] = 'd1a3f5b7c902'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'parameter_defs',
        sa.Column('needs_work', sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
    )


def downgrade() -> None:
    op.drop_column('parameter_defs', 'needs_work')
