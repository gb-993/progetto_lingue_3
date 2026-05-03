"""create missing submission tables

Tabelle dei backup linguistici (Submission e collegate) presenti nei
modelli SQLAlchemy ma mai create da nessuna migration: su DB legacy
erano state create da un vecchio `Base.metadata.create_all` poi rimosso
da `main.py`. Su DB nuovi questa migration le crea, sbloccando la
migration successiva `c4f8a17b9d20` che aggiunge la colonna
`motivation_label` a `submission_answer_motivations`.

La migration è idempotente: se le tabelle esistono già (DB legacy)
il blocco viene saltato e la migration è un no-op.

Revision ID: f5a8c2d4b7e0
Revises: b1d4e7f0a3c5
Create Date: 2026-04-30 11:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f5a8c2d4b7e0'
down_revision: Union[str, Sequence[str], None] = 'b1d4e7f0a3c5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = set(inspector.get_table_names())

    if 'submissions' not in existing:
        op.create_table(
            'submissions',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('language_id', sa.String(length=10),
                      sa.ForeignKey('languages.id', ondelete='CASCADE'),
                      nullable=False),
            sa.Column('submitted_by_id', sa.Integer(),
                      sa.ForeignKey('users.id', ondelete='SET NULL'),
                      nullable=True),
            sa.Column('submitted_at', sa.DateTime(), nullable=True),
            sa.Column('note', sa.Text(), nullable=True),
        )
        op.create_index(op.f('ix_submissions_id'), 'submissions', ['id'])
        op.create_index(op.f('ix_submissions_submitted_at'),
                        'submissions', ['submitted_at'])

    if 'submission_answers' not in existing:
        op.create_table(
            'submission_answers',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('submission_id', sa.Integer(),
                      sa.ForeignKey('submissions.id', ondelete='CASCADE'),
                      nullable=False),
            sa.Column('question_code', sa.String(length=40), nullable=False),
            sa.Column('response_text', sa.String(length=50), nullable=True),
            sa.Column('comments', sa.Text(), nullable=True),
        )
        op.create_index(op.f('ix_submission_answers_id'),
                        'submission_answers', ['id'])

    if 'submission_examples' not in existing:
        op.create_table(
            'submission_examples',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('submission_id', sa.Integer(),
                      sa.ForeignKey('submissions.id', ondelete='CASCADE'),
                      nullable=False),
            sa.Column('question_code', sa.String(length=40), nullable=False),
            sa.Column('textarea', sa.Text(), nullable=True),
            sa.Column('transliteration', sa.Text(), nullable=True),
            sa.Column('gloss', sa.Text(), nullable=True),
            sa.Column('translation', sa.Text(), nullable=True),
            sa.Column('reference', sa.Text(), nullable=True),
        )
        op.create_index(op.f('ix_submission_examples_id'),
                        'submission_examples', ['id'])

    if 'submission_answer_motivations' not in existing:
        # `motivation_label` è omessa di proposito: viene aggiunta dalla
        # migration successiva c4f8a17b9d20, così la storia delle modifiche
        # resta coerente anche per chi parte da zero.
        op.create_table(
            'submission_answer_motivations',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('submission_id', sa.Integer(),
                      sa.ForeignKey('submissions.id', ondelete='CASCADE'),
                      nullable=False),
            sa.Column('question_code', sa.String(length=40), nullable=False),
            sa.Column('motivation_code', sa.String(length=50), nullable=False),
        )
        op.create_index(op.f('ix_submission_answer_motivations_id'),
                        'submission_answer_motivations', ['id'])

    if 'submission_params' not in existing:
        op.create_table(
            'submission_params',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('submission_id', sa.Integer(),
                      sa.ForeignKey('submissions.id', ondelete='CASCADE'),
                      nullable=False),
            sa.Column('parameter_id', sa.String(length=10), nullable=False),
            sa.Column('value_orig', sa.String(length=10), nullable=True),
            sa.Column('warning_orig', sa.Boolean(), nullable=True),
            sa.Column('value_eval', sa.String(length=10), nullable=True),
            sa.Column('warning_eval', sa.Boolean(), nullable=True),
            sa.Column('evaluated_at', sa.DateTime(), nullable=True),
        )
        op.create_index(op.f('ix_submission_params_id'),
                        'submission_params', ['id'])


def downgrade() -> None:
    op.drop_index(op.f('ix_submission_params_id'), table_name='submission_params')
    op.drop_table('submission_params')
    op.drop_index(op.f('ix_submission_answer_motivations_id'),
                  table_name='submission_answer_motivations')
    op.drop_table('submission_answer_motivations')
    op.drop_index(op.f('ix_submission_examples_id'),
                  table_name='submission_examples')
    op.drop_table('submission_examples')
    op.drop_index(op.f('ix_submission_answers_id'),
                  table_name='submission_answers')
    op.drop_table('submission_answers')
    op.drop_index(op.f('ix_submissions_submitted_at'), table_name='submissions')
    op.drop_index(op.f('ix_submissions_id'), table_name='submissions')
    op.drop_table('submissions')
