"""editing_sessions: presence effimera per l'avviso di modifica concorrente

Tabella di sole righe vive (heartbeat): una per (entity_type, entity_id,
user_id). Usata per mostrare un banner anonimo "un altro utente sta
modificando". Le righe scadute vengono ripulite a runtime, quindi non
costituisce uno storico.

Revision ID: d2e4f6a8b013
Revises: c1a2b3d4e5f6
Create Date: 2026-06-09 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd2e4f6a8b013'
down_revision: Union[str, Sequence[str], None] = 'c1a2b3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'editing_sessions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('entity_type', sa.String(length=20), nullable=False),
        sa.Column('entity_id', sa.String(length=40), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('last_heartbeat', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('entity_type', 'entity_id', 'user_id', name='uq_editing_session'),
    )
    op.create_index('ix_editing_session_entity', 'editing_sessions', ['entity_type', 'entity_id'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_editing_session_entity', table_name='editing_sessions')
    op.drop_table('editing_sessions')
