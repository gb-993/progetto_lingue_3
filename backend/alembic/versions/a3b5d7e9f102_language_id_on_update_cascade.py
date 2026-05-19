"""abilita ON UPDATE CASCADE sulle FK verso languages.id

Permette di rinominare l'id di una Language: Postgres propaga il nuovo
valore alle tabelle figlie (answers, language_parameters,
language_parameter_statuses, submissions) nella stessa transazione.

Le tabelle che salvano `language_id` come stringa denormalizzata senza FK
(archived_answers.language_id, entity_versions.entity_id) NON vengono
toccate: per design conservano il valore "fotografato" al momento
dell'archiviazione/log.

Revision ID: a3b5d7e9f102
Revises: c1d4f7e9a302
Create Date: 2026-05-19 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'a3b5d7e9f102'
down_revision: Union[str, Sequence[str], None] = 'c1d4f7e9a302'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Tutte le FK sono state create da SQLAlchemy senza nome esplicito,
# quindi Postgres usa il default `<table>_<column>_fkey`.
#
# `submissions.language_id` ha ondelete=CASCADE preesistente: va preservato
# nel re-create. Le altre tre non hanno ondelete.
FK_LIST = [
    # (constraint_name, source_table, ondelete)
    ("answers_language_id_fkey", "answers", None),
    ("language_parameters_language_id_fkey", "language_parameters", None),
    ("language_parameter_statuses_language_id_fkey", "language_parameter_statuses", None),
    ("submissions_language_id_fkey", "submissions", "CASCADE"),
]


def upgrade() -> None:
    """Drop + recreate delle 4 FK aggiungendo onupdate=CASCADE."""
    for fk_name, table, ondelete in FK_LIST:
        op.drop_constraint(fk_name, table, type_="foreignkey")
        op.create_foreign_key(
            fk_name,
            table,
            "languages",
            ["language_id"],
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
            "languages",
            ["language_id"],
            ["id"],
            ondelete=ondelete,
        )
