"""abilita ON UPDATE CASCADE sulle FK verso questions.id

Permette di rinominare l'id di una Question: Postgres propaga il nuovo
valore alle tabelle figlie (answers, question_allowed_motivations) nella
stessa transazione.

Le tabelle che salvano `question_id`/`original_question_id` come stringa
denormalizzata senza FK (archived_questions.original_question_id,
entity_versions.entity_id) NON vengono toccate: per design conservano il
valore "fotografato" al momento dell'archiviazione/log. Il fallback per
restore/import e' la tabella question_aliases (migrazione successiva).

Revision ID: e1a2c3d4f506
Revises: d9f2b4e6c1a3
Create Date: 2026-06-04 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'e1a2c3d4f506'
down_revision: Union[str, Sequence[str], None] = 'd9f2b4e6c1a3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Le FK sono state create da SQLAlchemy senza nome esplicito, quindi Postgres
# usa il default `<table>_<column>_fkey`.
#
# `question_allowed_motivations.question_id` ha ondelete=CASCADE preesistente:
# va preservato nel re-create. `answers.question_id` non ha ondelete.
FK_LIST = [
    # (constraint_name, source_table, ondelete)
    ("answers_question_id_fkey", "answers", None),
    ("question_allowed_motivations_question_id_fkey", "question_allowed_motivations", "CASCADE"),
]


def upgrade() -> None:
    """Drop + recreate delle FK aggiungendo onupdate=CASCADE."""
    for fk_name, table, ondelete in FK_LIST:
        op.drop_constraint(fk_name, table, type_="foreignkey")
        op.create_foreign_key(
            fk_name,
            table,
            "questions",
            ["question_id"],
            ["id"],
            onupdate="CASCADE",
            ondelete=ondelete,
        )


def downgrade() -> None:
    """Ripristina le FK senza onupdate (mantiene l'ondelete originario)."""
    for fk_name, table, ondelete in FK_LIST:
        op.drop_constraint(fk_name, table, type_="foreignkey")
        op.create_foreign_key(
            fk_name,
            table,
            "questions",
            ["question_id"],
            ["id"],
            ondelete=ondelete,
        )
