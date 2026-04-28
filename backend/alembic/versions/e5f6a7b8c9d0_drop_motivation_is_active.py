"""drop motivations.is_active

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-04-28 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e5f6a7b8c9d0'
down_revision: Union[str, Sequence[str], None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column('motivations', 'is_active')


def downgrade() -> None:
    op.add_column(
        'motivations',
        sa.Column('is_active', sa.Boolean(), nullable=True, server_default=sa.true()),
    )
