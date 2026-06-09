"""parameter_defs.admin_remarks: nota libera interna per gli admin

Campo di servizio sul ParameterDef (uno per parametro, valido per tutte le
lingue). Distinto dalla admin_note di language_parameter_statuses, che invece
e' per (lingua, parametro). Non viene esportato negli Excel.

Revision ID: c1a2b3d4e5f6
Revises: b8d4f6a1c302
Create Date: 2026-06-09 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c1a2b3d4e5f6'
down_revision: Union[str, Sequence[str], None] = 'b8d4f6a1c302'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # server_default="" così le righe gia' esistenti vengono valorizzate a ""
    # invece di NULL (la response Pydantic richiede un `str`).
    op.add_column(
        'parameter_defs',
        sa.Column('admin_remarks', sa.Text(), nullable=True, server_default=''),
    )


def downgrade() -> None:
    op.drop_column('parameter_defs', 'admin_remarks')
