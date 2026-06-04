"""parameter_aliases: storico degli id rinominati dei ParameterDef

Permette al restore di backup e all'import Excel di riconoscere un parametro
anche quando il suo id corrente differisce da quello salvato nel file.
Speculare a language_aliases / question_aliases.

Revision ID: b8d4f6a1c302
Revises: a7c3e5f9b201
Create Date: 2026-06-04 01:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b8d4f6a1c302'
down_revision: Union[str, Sequence[str], None] = 'a7c3e5f9b201'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'parameter_aliases',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('parameter_id', sa.String(length=10), nullable=False),
        sa.Column('old_id', sa.String(length=10), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ['parameter_id'], ['parameter_defs.id'],
            ondelete='CASCADE', onupdate='CASCADE',
            name='parameter_aliases_parameter_id_fkey',
        ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('old_id', name='uq_parameter_aliases_old_id'),
    )
    op.create_index(
        op.f('ix_parameter_aliases_parameter_id'),
        'parameter_aliases', ['parameter_id'], unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f('ix_parameter_aliases_parameter_id'), table_name='parameter_aliases')
    op.drop_table('parameter_aliases')
