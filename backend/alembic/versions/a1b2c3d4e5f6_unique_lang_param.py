"""unique constraint on language_parameters(language_id, parameter_id)

Revision ID: a1b2c3d4e5f6
Revises: af7d3a68ac04
Create Date: 2026-04-27 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = 'af7d3a68ac04'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema.

    Pulisce eventuali righe duplicate in `language_parameters` (stesso
    language_id+parameter_id) prima di applicare l'unique constraint.
    Tiene la riga con id più alto (la più recente) e ne cancella gli
    eval associati alle righe scartate.
    """
    op.execute("""
        DELETE FROM language_parameter_evals
        WHERE language_parameter_id IN (
            SELECT id FROM language_parameters
            WHERE id NOT IN (
                SELECT MAX(id) FROM language_parameters
                GROUP BY language_id, parameter_id
            )
        );
    """)
    op.execute("""
        DELETE FROM language_parameters
        WHERE id NOT IN (
            SELECT MAX(id) FROM language_parameters
            GROUP BY language_id, parameter_id
        );
    """)
    op.create_unique_constraint(
        'uq_language_parameter_lang_param',
        'language_parameters',
        ['language_id', 'parameter_id']
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(
        'uq_language_parameter_lang_param',
        'language_parameters',
        type_='unique'
    )
