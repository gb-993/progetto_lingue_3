"""language workflow status

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-04-27 00:00:01.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    language_status = sa.Enum(
        'pending', 'waiting_for_approval', 'approved', 'rejected',
        name='language_status'
    )
    language_status.create(op.get_bind(), checkfirst=True)

    op.add_column(
        'languages',
        sa.Column('status', language_status, nullable=False, server_default='pending')
    )
    op.add_column('languages', sa.Column('rejection_note', sa.Text(), nullable=True))
    op.add_column('languages', sa.Column('submitted_at', sa.DateTime(), nullable=True))
    op.add_column('languages', sa.Column('reviewed_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('languages', 'reviewed_at')
    op.drop_column('languages', 'submitted_at')
    op.drop_column('languages', 'rejection_note')
    op.drop_column('languages', 'status')

    sa.Enum(name='language_status').drop(op.get_bind(), checkfirst=True)
