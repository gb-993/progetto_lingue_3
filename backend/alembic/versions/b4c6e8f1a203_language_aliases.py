"""language_aliases: storico degli id rinominati delle Language

Permette al restore di backup e all'import Excel di riconoscere una lingua
anche quando il suo id corrente differisce da quello salvato nel file
(perche' nel frattempo e' stata rinominata via UI admin).

Revision ID: b4c6e8f1a203
Revises: a3b5d7e9f102
Create Date: 2026-05-19 00:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b4c6e8f1a203'
down_revision: Union[str, Sequence[str], None] = 'a3b5d7e9f102'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'language_aliases',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('language_id', sa.String(length=10), nullable=False),
        sa.Column('old_id', sa.String(length=10), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ['language_id'], ['languages.id'],
            ondelete='CASCADE', onupdate='CASCADE',
            name='language_aliases_language_id_fkey',
        ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('old_id', name='uq_language_aliases_old_id'),
    )
    op.create_index(
        op.f('ix_language_aliases_language_id'),
        'language_aliases', ['language_id'], unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f('ix_language_aliases_language_id'), table_name='language_aliases')
    op.drop_table('language_aliases')
