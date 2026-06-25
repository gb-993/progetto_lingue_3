"""language status redesign: due assi (review draft/submitted/validated + completion_override)

Ridisegno dello status della lingua. Prima un solo enum `language_status`
(pending/waiting_for_approval/approved/rejected) mescolava completamento e
flusso di approvazione. Ora:

  - `languages.status` (ASSE B, review umana): draft/submitted/validated.
      pending  -> draft
      rejected -> draft
      waiting_for_approval -> submitted
      approved -> validated
  - `languages.completion_override` (ASSE A, override super-admin): nuovo enum
      `language_completion` (empty/incomplete/complete), nullable. NULL = il
      completamento è calcolato live dai colori dei quadratini.

L'enum `answer_status` (stessi valori vecchi) NON viene toccato: riguarda le
singole answer, non la lingua.

Su Postgres si fa lo swap del tipo enum con USING di mapping. Su altri dialetti
(SQLite nei test non esegue migrazioni) si esce silenziosamente.

Revision ID: d1a3f5b7c902
Revises: c7e9b2d4f016
Create Date: 2026-06-25 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd1a3f5b7c902'
down_revision: Union[str, Sequence[str], None] = 'c7e9b2d4f016'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()

    # --- ASSE A: nuovo enum + colonna override (nullable) ---
    completion = sa.Enum('empty', 'incomplete', 'complete', name='language_completion')
    completion.create(bind, checkfirst=True)
    op.add_column('languages', sa.Column('completion_override', completion, nullable=True))

    # --- ASSE B: swap dell'enum language_status con mapping dei dati ---
    if bind.dialect.name == 'postgresql':
        op.execute("ALTER TABLE languages ALTER COLUMN status DROP DEFAULT")
        op.execute("ALTER TYPE language_status RENAME TO language_status_old")
        sa.Enum('draft', 'submitted', 'validated', name='language_status').create(bind, checkfirst=False)
        op.execute(
            """
            ALTER TABLE languages
            ALTER COLUMN status TYPE language_status
            USING (
                CASE status::text
                    WHEN 'pending' THEN 'draft'
                    WHEN 'rejected' THEN 'draft'
                    WHEN 'waiting_for_approval' THEN 'submitted'
                    WHEN 'approved' THEN 'validated'
                    ELSE 'draft'
                END
            )::language_status
            """
        )
        op.execute("ALTER TABLE languages ALTER COLUMN status SET DEFAULT 'draft'")
        op.execute("DROP TYPE language_status_old")


def downgrade() -> None:
    bind = op.get_bind()

    if bind.dialect.name == 'postgresql':
        op.execute("ALTER TABLE languages ALTER COLUMN status DROP DEFAULT")
        op.execute("ALTER TYPE language_status RENAME TO language_status_new")
        sa.Enum(
            'pending', 'waiting_for_approval', 'approved', 'rejected',
            name='language_status',
        ).create(bind, checkfirst=False)
        op.execute(
            """
            ALTER TABLE languages
            ALTER COLUMN status TYPE language_status
            USING (
                CASE status::text
                    WHEN 'draft' THEN 'pending'
                    WHEN 'submitted' THEN 'waiting_for_approval'
                    WHEN 'validated' THEN 'approved'
                    ELSE 'pending'
                END
            )::language_status
            """
        )
        op.execute("ALTER TABLE languages ALTER COLUMN status SET DEFAULT 'pending'")
        op.execute("DROP TYPE language_status_new")

    op.drop_column('languages', 'completion_override')
    sa.Enum(name='language_completion').drop(bind, checkfirst=True)
