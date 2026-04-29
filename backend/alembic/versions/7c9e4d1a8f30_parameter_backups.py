"""parameter backup tables

Tabelle per salvare snapshot della *definizione* di un parametro (ParameterDef
+ Questions + motivations ammesse). Sono separate dalle `submissions` (che
contengono i dati per lingua) per non sovrapporre le due funzioni di backup.

Revision ID: 7c9e4d1a8f30
Revises: 5b9c1d3f7a2e
Create Date: 2026-04-29 13:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7c9e4d1a8f30'
down_revision: Union[str, Sequence[str], None] = '5b9c1d3f7a2e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'parameter_submissions',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('parameter_id', sa.String(length=10), nullable=False),
        sa.Column('parameter_name', sa.String(length=200), nullable=False, server_default=''),
        sa.Column('submitted_by_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('submitted_at', sa.DateTime(), nullable=True),
        sa.Column('note', sa.Text(), nullable=True, server_default=''),
        sa.Column('short_description', sa.Text(), nullable=True, server_default=''),
        sa.Column('long_description', sa.Text(), nullable=True, server_default=''),
        sa.Column('implicational_condition', sa.String(length=255), nullable=True),
        sa.Column('description_of_the_implicational_condition', sa.Text(), nullable=True, server_default=''),
        sa.Column('is_active', sa.Boolean(), nullable=True, server_default=sa.true()),
        sa.Column('position', sa.Integer(), nullable=True),
        sa.Column('schema', sa.String(length=100), nullable=True, server_default=''),
        sa.Column('param_type', sa.String(length=100), nullable=True, server_default=''),
        sa.Column('level_of_comparison', sa.String(length=255), nullable=True, server_default=''),
    )
    op.create_index('ix_parameter_submissions_parameter_id', 'parameter_submissions', ['parameter_id'])
    op.create_index('ix_parameter_submissions_submitted_at', 'parameter_submissions', ['submitted_at'])

    op.create_table(
        'parameter_submission_questions',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('submission_id', sa.Integer(),
                  sa.ForeignKey('parameter_submissions.id', ondelete='CASCADE'), nullable=False),
        sa.Column('question_code', sa.String(length=40), nullable=False),
        sa.Column('text', sa.Text(), nullable=False, server_default=''),
        sa.Column('template_type', sa.String(length=100), nullable=True, server_default=''),
        sa.Column('instruction', sa.Text(), nullable=True),
        sa.Column('instruction_yes', sa.Text(), nullable=True),
        sa.Column('instruction_no', sa.Text(), nullable=True),
        sa.Column('example_yes', sa.Text(), nullable=True),
        sa.Column('help_info', sa.Text(), nullable=True),
        sa.Column('is_stop_question', sa.Boolean(), nullable=True, server_default=sa.false()),
        sa.Column('is_active', sa.Boolean(), nullable=True, server_default=sa.true()),
    )

    op.create_table(
        'parameter_submission_allowed_motivations',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('question_id', sa.Integer(),
                  sa.ForeignKey('parameter_submission_questions.id', ondelete='CASCADE'), nullable=False),
        sa.Column('motivation_code', sa.String(length=50), nullable=False),
        sa.Column('motivation_label', sa.Text(), nullable=False, server_default=''),
    )


def downgrade() -> None:
    op.drop_table('parameter_submission_allowed_motivations')
    op.drop_table('parameter_submission_questions')
    op.drop_index('ix_parameter_submissions_submitted_at', table_name='parameter_submissions')
    op.drop_index('ix_parameter_submissions_parameter_id', table_name='parameter_submissions')
    op.drop_table('parameter_submissions')
