"""submission_examples.is_test: conserva il flag esempio-di-test negli snapshot

Copia di examples.is_test sullo snapshot di backup (SubmissionExample), così il
flag "esempio di test" è preservato nei backup History e nel round-trip del
backup completo (export/restore).

Revision ID: c7e9b2d4f016
Revises: b5d7f9a1c248
Create Date: 2026-06-25 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c7e9b2d4f016'
down_revision: Union[str, Sequence[str], None] = 'b5d7f9a1c248'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'submission_examples',
        sa.Column('is_test', sa.Boolean(), nullable=False, server_default=sa.text('false')),
    )


def downgrade() -> None:
    op.drop_column('submission_examples', 'is_test')
