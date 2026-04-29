"""admin_note on language_parameter_statuses

Aggiunge una nota di testo libero per (lingua, parametro), visibile e
modificabile solo dagli admin.

Revision ID: 5b9c1d3f7a2e
Revises: a8c2d5e9b3f1
Create Date: 2026-04-29 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5b9c1d3f7a2e'
down_revision: Union[str, Sequence[str], None] = 'a8c2d5e9b3f1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'language_parameter_statuses',
        sa.Column('admin_note', sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('language_parameter_statuses', 'admin_note')
