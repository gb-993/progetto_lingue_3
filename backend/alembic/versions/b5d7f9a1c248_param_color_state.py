"""colori quadratini: examples.is_test + language_parameter_statuses.needs_review

Due colonne di servizio per la nuova logica colore del wizard (Fase 1):
  - examples.is_test: esempio "di test"/segnaposto (solo admin) → giallo.
  - language_parameter_statuses.needs_review: parametro da ricontrollare dopo
    una modifica seria a una sua question → giallo, finché la lingua non risalva.

Entrambe NOT NULL con server_default false così le righe esistenti restano
coerenti.

Revision ID: b5d7f9a1c248
Revises: a3f1c7e9d025
Create Date: 2026-06-25 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b5d7f9a1c248'
down_revision: Union[str, Sequence[str], None] = 'a3f1c7e9d025'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'examples',
        sa.Column('is_test', sa.Boolean(), nullable=False, server_default=sa.text('false')),
    )
    op.add_column(
        'language_parameter_statuses',
        sa.Column('needs_review', sa.Boolean(), nullable=False, server_default=sa.text('false')),
    )


def downgrade() -> None:
    op.drop_column('language_parameter_statuses', 'needs_review')
    op.drop_column('examples', 'is_test')
