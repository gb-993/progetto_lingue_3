"""language updated_at

Aggiunge la colonna `updated_at` alla tabella `languages` per tracciare
quando i metadati di una lingua sono stati modificati l'ultima volta.

La colonna è popolata da SQLAlchemy via `default=utc_now` / `onupdate=utc_now`
sul modello. La migrazione la inizializza a CURRENT_TIMESTAMP per le righe
pre-esistenti così che la prossima query SELECT restituisca un valore
ragionevole anche per lingue mai modificate dopo il deploy.

Revision ID: d8e2f5b9a410
Revises: 97b7056f516e
Create Date: 2026-05-07 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd8e2f5b9a410'
down_revision: Union[str, Sequence[str], None] = '97b7056f516e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'languages',
        sa.Column('updated_at', sa.DateTime(), nullable=True),
    )
    op.execute("UPDATE languages SET updated_at = CURRENT_TIMESTAMP WHERE updated_at IS NULL")


def downgrade() -> None:
    op.drop_column('languages', 'updated_at')
