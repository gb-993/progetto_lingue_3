"""add indexes on Answer.question_id and LanguageParameterStatus.parameter_id

Aggiunge due indici single-column per supportare le query che filtrano
solo sul lato "destro" delle UniqueConstraint composite esistenti
(language_id, question_id) e (language_id, parameter_id):

- Answer.question_id: usato da export, history e da consolidate quando
  raccoglie tutte le risposte a una stessa domanda cross-language.
- LanguageParameterStatus.parameter_id: usato da consolidate e dashboard
  quando aggregano lo stato di un parametro su tutte le lingue.

Le query sul leftmost (language_id) sono già coperte dall'indice della
UniqueConstraint, quindi non aggiungiamo indici lì.

Revision ID: 97b7056f516e
Revises: c8e1a4f6d3b2
Create Date: 2026-05-02
"""
from typing import Sequence, Union

from alembic import op


revision: str = '97b7056f516e'
down_revision: Union[str, Sequence[str], None] = 'c8e1a4f6d3b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        op.f('ix_answers_question_id'),
        'answers',
        ['question_id'],
        unique=False,
    )
    op.create_index(
        op.f('ix_language_parameter_statuses_parameter_id'),
        'language_parameter_statuses',
        ['parameter_id'],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f('ix_language_parameter_statuses_parameter_id'),
        table_name='language_parameter_statuses',
    )
    op.drop_index(
        op.f('ix_answers_question_id'),
        table_name='answers',
    )
