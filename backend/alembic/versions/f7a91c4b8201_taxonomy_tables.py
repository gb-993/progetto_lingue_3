"""Taxonomy: top_families, families, groups

Revision ID: f7a91c4b8201
Revises: e5f6a7b8c9d0
Create Date: 2026-04-28 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f7a91c4b8201'
down_revision: Union[str, Sequence[str], None] = 'e5f6a7b8c9d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'top_families',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('position', sa.Integer(), nullable=False, server_default='0'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name'),
    )

    op.create_table(
        'families',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('top_family_id', sa.Integer(), nullable=True),
        sa.Column('position', sa.Integer(), nullable=False, server_default='0'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name'),
        sa.ForeignKeyConstraint(['top_family_id'], ['top_families.id'], ondelete='SET NULL'),
    )

    op.create_table(
        'groups',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('family_id', sa.Integer(), nullable=True),
        sa.Column('position', sa.Integer(), nullable=False, server_default='0'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name'),
        sa.ForeignKeyConstraint(['family_id'], ['families.id'], ondelete='SET NULL'),
    )


def downgrade() -> None:
    op.drop_table('groups')
    op.drop_table('families')
    op.drop_table('top_families')
