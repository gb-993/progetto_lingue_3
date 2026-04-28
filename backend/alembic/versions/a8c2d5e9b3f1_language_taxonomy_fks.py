"""Language: FK to taxonomy (top_family_id, family_id, group_id)

Revision ID: a8c2d5e9b3f1
Revises: f7a91c4b8201
Create Date: 2026-04-28 00:01:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a8c2d5e9b3f1'
down_revision: Union[str, Sequence[str], None] = 'f7a91c4b8201'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('languages', sa.Column('top_family_id', sa.Integer(), nullable=True))
    op.add_column('languages', sa.Column('family_id', sa.Integer(), nullable=True))
    op.add_column('languages', sa.Column('group_id', sa.Integer(), nullable=True))

    op.create_foreign_key(
        'fk_languages_top_family', 'languages', 'top_families',
        ['top_family_id'], ['id'], ondelete='SET NULL',
    )
    op.create_foreign_key(
        'fk_languages_family', 'languages', 'families',
        ['family_id'], ['id'], ondelete='SET NULL',
    )
    op.create_foreign_key(
        'fk_languages_group', 'languages', 'groups',
        ['group_id'], ['id'], ondelete='SET NULL',
    )


def downgrade() -> None:
    op.drop_constraint('fk_languages_group', 'languages', type_='foreignkey')
    op.drop_constraint('fk_languages_family', 'languages', type_='foreignkey')
    op.drop_constraint('fk_languages_top_family', 'languages', type_='foreignkey')
    op.drop_column('languages', 'group_id')
    op.drop_column('languages', 'family_id')
    op.drop_column('languages', 'top_family_id')
