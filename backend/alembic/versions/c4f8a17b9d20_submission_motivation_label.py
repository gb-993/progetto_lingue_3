"""submission_answer_motivations.motivation_label

Aggiunge lo snapshot del testo della motivazione (label) ai backup delle
lingue. Senza questo campo i backup conservavano solo il `code` della
motivazione: se la motivazione veniva modificata o eliminata, dallo storico
non era piu' possibile ricostruire cosa volesse dire quel codice.

Per i backup gia' esistenti facciamo un best-effort: copiamo il label
corrente dalla tabella `motivations` quando esiste un'unica motivazione con
quel `code`. Per i casi ambigui (code presente piu' volte) lasciamo NULL: il
codice restera' l'unica informazione disponibile per quei vecchi record.

Revision ID: c4f8a17b9d20
Revises: b1d4e7f0a3c5
Create Date: 2026-04-30 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c4f8a17b9d20'
down_revision: Union[str, Sequence[str], None] = 'b1d4e7f0a3c5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'submission_answer_motivations',
        sa.Column('motivation_label', sa.Text(), nullable=True),
    )

    # Best-effort backfill: solo quando il code identifica univocamente una motivazione.
    op.execute("""
        UPDATE submission_answer_motivations AS sam
        SET motivation_label = m.label
        FROM motivations AS m
        WHERE m.code = sam.motivation_code
          AND (
              SELECT COUNT(*) FROM motivations m2 WHERE m2.code = sam.motivation_code
          ) = 1
    """)


def downgrade() -> None:
    op.drop_column('submission_answer_motivations', 'motivation_label')
