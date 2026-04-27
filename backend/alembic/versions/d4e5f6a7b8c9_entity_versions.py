"""entity_versions table for granular history

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-04-27 00:00:03.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, Sequence[str], None] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'entity_versions',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('entity_type', sa.String(length=40), nullable=False),
        sa.Column('entity_id', sa.String(length=50), nullable=False),
        sa.Column('snapshot', sa.JSON(), nullable=False),
        sa.Column('operation', sa.String(length=20), nullable=False, server_default='update'),
        sa.Column('source', sa.String(length=40), nullable=False, server_default='manual'),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_entity_versions_entity_type', 'entity_versions', ['entity_type'])
    op.create_index('ix_entity_versions_entity_id', 'entity_versions', ['entity_id'])
    op.create_index('ix_entity_versions_created_at', 'entity_versions', ['created_at'])
    op.create_index('ix_entity_versions_lookup', 'entity_versions', ['entity_type', 'entity_id', 'created_at'])


def downgrade() -> None:
    op.drop_index('ix_entity_versions_lookup', table_name='entity_versions')
    op.drop_index('ix_entity_versions_created_at', table_name='entity_versions')
    op.drop_index('ix_entity_versions_entity_id', table_name='entity_versions')
    op.drop_index('ix_entity_versions_entity_type', table_name='entity_versions')
    op.drop_table('entity_versions')
