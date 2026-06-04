"""question_aliases: storico degli id rinominati delle Question

Permette al restore di backup e all'import Excel di riconoscere una domanda
anche quando il suo id corrente differisce da quello salvato nel file
(perche' nel frattempo e' stata rinominata via UI admin). Speculare a
language_aliases.

Revision ID: f2b3d4e5a607
Revises: e1a2c3d4f506
Create Date: 2026-06-04 00:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f2b3d4e5a607'
down_revision: Union[str, Sequence[str], None] = 'e1a2c3d4f506'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'question_aliases',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('question_id', sa.String(length=40), nullable=False),
        sa.Column('old_id', sa.String(length=40), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ['question_id'], ['questions.id'],
            ondelete='CASCADE', onupdate='CASCADE',
            name='question_aliases_question_id_fkey',
        ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('old_id', name='uq_question_aliases_old_id'),
    )
    op.create_index(
        op.f('ix_question_aliases_question_id'),
        'question_aliases', ['question_id'], unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f('ix_question_aliases_question_id'), table_name='question_aliases')
    op.drop_table('question_aliases')
