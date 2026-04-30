"""archived questions tables

Tabelle per archiviare le risposte (Answer + Example + AnswerMotivation)
collegate a una Question quando il suo testo viene modificato in modo
incompatibile con i dati raccolti. Si congela anche lo snapshot della
question stessa al momento dell'archiviazione (testo, istruzioni, motivations
ammesse) per poter ricostruire il contesto della vecchia versione.

Le motivations e le lingue sono denormalizzate (code/label/name salvati
come stringhe, niente FK rigida) cosi' l'archivio resta consistente anche
se in futuro vengono rinominate o eliminate. Stesso pattern di
ParameterSubmission.

Revision ID: b1d4e7f0a3c5
Revises: 7c9e4d1a8f30
Create Date: 2026-04-30 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b1d4e7f0a3c5'
down_revision: Union[str, Sequence[str], None] = '7c9e4d1a8f30'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'archived_questions',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('original_question_id', sa.String(length=40), nullable=False),
        sa.Column('parameter_id', sa.String(length=10), nullable=False),
        sa.Column('parameter_name', sa.String(length=200), nullable=False, server_default=''),
        sa.Column('text', sa.Text(), nullable=False, server_default=''),
        sa.Column('template_type', sa.String(length=100), nullable=True, server_default=''),
        sa.Column('instruction', sa.Text(), nullable=True),
        sa.Column('instruction_yes', sa.Text(), nullable=True),
        sa.Column('instruction_no', sa.Text(), nullable=True),
        sa.Column('example_yes', sa.Text(), nullable=True),
        sa.Column('help_info', sa.Text(), nullable=True),
        sa.Column('is_stop_question', sa.Boolean(), nullable=True, server_default=sa.false()),
        sa.Column('is_active', sa.Boolean(), nullable=True, server_default=sa.true()),
        sa.Column('archived_at', sa.DateTime(), nullable=False),
        sa.Column('archived_by_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('archive_note', sa.Text(), nullable=True, server_default=''),
        sa.Column('answers_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('examples_count', sa.Integer(), nullable=False, server_default='0'),
    )
    op.create_index('ix_archived_questions_original_id', 'archived_questions', ['original_question_id'])
    op.create_index('ix_archived_questions_archived_at', 'archived_questions', ['archived_at'])

    op.create_table(
        'archived_question_motivations',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('archived_question_id', sa.Integer(),
                  sa.ForeignKey('archived_questions.id', ondelete='CASCADE'), nullable=False),
        sa.Column('motivation_code', sa.String(length=50), nullable=False),
        sa.Column('motivation_label', sa.Text(), nullable=False, server_default=''),
    )

    op.create_table(
        'archived_answers',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('archived_question_id', sa.Integer(),
                  sa.ForeignKey('archived_questions.id', ondelete='CASCADE'), nullable=False),
        sa.Column('language_id', sa.String(length=10), nullable=False),
        sa.Column('language_name_full', sa.String(length=255), nullable=False, server_default=''),
        sa.Column('status', sa.String(length=40), nullable=True),
        sa.Column('response_text', sa.String(length=10), nullable=True),
        sa.Column('comments', sa.Text(), nullable=True),
        sa.Column('original_updated_at', sa.DateTime(), nullable=True),
    )
    op.create_index('ix_archived_answers_archq', 'archived_answers', ['archived_question_id'])

    op.create_table(
        'archived_examples',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('archived_answer_id', sa.Integer(),
                  sa.ForeignKey('archived_answers.id', ondelete='CASCADE'), nullable=False),
        sa.Column('number', sa.String(length=10), nullable=True, server_default=''),
        sa.Column('textarea', sa.Text(), nullable=True),
        sa.Column('transliteration', sa.Text(), nullable=True),
        sa.Column('gloss', sa.Text(), nullable=True),
        sa.Column('translation', sa.Text(), nullable=True),
        sa.Column('reference', sa.Text(), nullable=True),
    )

    op.create_table(
        'archived_answer_motivations',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('archived_answer_id', sa.Integer(),
                  sa.ForeignKey('archived_answers.id', ondelete='CASCADE'), nullable=False),
        sa.Column('motivation_code', sa.String(length=50), nullable=False),
        sa.Column('motivation_label', sa.Text(), nullable=False, server_default=''),
    )


def downgrade() -> None:
    op.drop_table('archived_answer_motivations')
    op.drop_table('archived_examples')
    op.drop_index('ix_archived_answers_archq', table_name='archived_answers')
    op.drop_table('archived_answers')
    op.drop_table('archived_question_motivations')
    op.drop_index('ix_archived_questions_archived_at', table_name='archived_questions')
    op.drop_index('ix_archived_questions_original_id', table_name='archived_questions')
    op.drop_table('archived_questions')
