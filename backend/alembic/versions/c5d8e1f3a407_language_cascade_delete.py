"""ON DELETE CASCADE sulle FK che bloccavano la cancellazione di una Language

Per permettere la cancellazione "vera" di una lingua e dei suoi dati di
compilazione/parametri/backup, aggiungiamo ondelete=CASCADE alle 5 FK che
oggi sono in NO ACTION:

  Verso languages.id (mantengono anche onupdate=CASCADE precedente):
    - answers.language_id
    - language_parameters.language_id
    - language_parameter_statuses.language_id

  Verso answers.id / language_parameters.id (cascate indirette):
    - examples.answer_id
    - language_parameter_evals.language_parameter_id

Le FK gia' a cascata (submissions, language_aliases, answer_motivations,
submission_*) restano invariate.

Le tabelle storiche `entity_versions` e `archived_answers` NON hanno FK
verso languages/answers: sono snapshot per design, non vanno toccate dalla
cascata.

Revision ID: c5d8e1f3a407
Revises: b4c6e8f1a203
Create Date: 2026-05-19 00:20:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'c5d8e1f3a407'
down_revision: Union[str, Sequence[str], None] = 'b4c6e8f1a203'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (constraint_name, source_table, referent_table, local_cols, remote_cols, onupdate)
# onupdate gia' presente nelle FK verso languages.id (migrazione a3b5d7e9f102),
# va preservato. Le FK verso answers.id / language_parameters.id non hanno
# onupdate (le PK sono integer auto-increment, non rinominabili in pratica).
FK_LIST = [
    ("answers_language_id_fkey", "answers", "languages", ["language_id"], ["id"], "CASCADE"),
    ("language_parameters_language_id_fkey", "language_parameters", "languages", ["language_id"], ["id"], "CASCADE"),
    ("language_parameter_statuses_language_id_fkey", "language_parameter_statuses", "languages", ["language_id"], ["id"], "CASCADE"),
    ("examples_answer_id_fkey", "examples", "answers", ["answer_id"], ["id"], None),
    ("language_parameter_evals_language_parameter_id_fkey", "language_parameter_evals", "language_parameters", ["language_parameter_id"], ["id"], None),
]


def upgrade() -> None:
    for fk_name, src, ref, local, remote, onupdate in FK_LIST:
        op.drop_constraint(fk_name, src, type_="foreignkey")
        op.create_foreign_key(
            fk_name, src, ref, local, remote,
            onupdate=onupdate, ondelete="CASCADE",
        )


def downgrade() -> None:
    """Ripristina lo stato precedente: niente ondelete."""
    for fk_name, src, ref, local, remote, onupdate in FK_LIST:
        op.drop_constraint(fk_name, src, type_="foreignkey")
        op.create_foreign_key(
            fk_name, src, ref, local, remote,
            onupdate=onupdate,
        )
