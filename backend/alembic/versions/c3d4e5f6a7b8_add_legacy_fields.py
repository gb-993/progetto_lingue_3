"""add legacy fields (isocode, glottocode, ..., example_yes, help_info, ...)

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-04-27 00:00:02.000000

Aggiunge campi metadata mancanti per allinearsi al vecchio progetto:
- Language: isocode, glottocode, informant, supervisor, source, location
- ParameterDef: long_description, description_of_the_implicational_condition
- Question: example_yes, help_info
- Example: number

Tutti nullable / con default vuoto: non distruttiva, non rompe dati esistenti.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, Sequence[str], None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Language
    op.add_column('languages', sa.Column('isocode', sa.String(length=20), nullable=True, server_default=''))
    op.add_column('languages', sa.Column('glottocode', sa.String(length=20), nullable=True, server_default=''))
    op.add_column('languages', sa.Column('informant', sa.String(length=255), nullable=True, server_default=''))
    op.add_column('languages', sa.Column('supervisor', sa.String(length=255), nullable=True, server_default=''))
    op.add_column('languages', sa.Column('source', sa.Text(), nullable=True, server_default=''))
    op.add_column('languages', sa.Column('location', sa.String(length=255), nullable=True, server_default=''))

    # ParameterDef
    op.add_column('parameter_defs', sa.Column('long_description', sa.Text(), nullable=True, server_default=''))
    op.add_column('parameter_defs', sa.Column('description_of_the_implicational_condition', sa.Text(), nullable=True, server_default=''))

    # Question
    op.add_column('questions', sa.Column('example_yes', sa.Text(), nullable=True))
    op.add_column('questions', sa.Column('help_info', sa.Text(), nullable=True))

    # Example
    op.add_column('examples', sa.Column('number', sa.String(length=10), nullable=True, server_default=''))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('examples', 'number')

    op.drop_column('questions', 'help_info')
    op.drop_column('questions', 'example_yes')

    op.drop_column('parameter_defs', 'description_of_the_implicational_condition')
    op.drop_column('parameter_defs', 'long_description')

    op.drop_column('languages', 'location')
    op.drop_column('languages', 'source')
    op.drop_column('languages', 'supervisor')
    op.drop_column('languages', 'informant')
    op.drop_column('languages', 'glottocode')
    op.drop_column('languages', 'isocode')
