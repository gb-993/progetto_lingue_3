"""legal documents + consents

Crea le tabelle `legal_documents` e `consents` per il tracciamento
delle accettazioni dei documenti legali (Terms of Use, Privacy Notice).

- `legal_documents`: archivio immutabile di tutte le versioni dei
  documenti legali. Per ogni `type` una sola riga puo' avere
  `is_current=True` (garantito da partial unique index).
- `consents`: una riga per ogni evento di accettazione (user x documento).
  FK rigida verso legal_documents per evitare consensi "fantasma".

Razionale legale e flusso: vedi PRIVACY_TODO_DPO.md (file locale,
gitignored) e i docstring dei modelli in models.py.

Revision ID: c1d4f7e9a302
Revises: e9f3a1b6c802
Create Date: 2026-05-18 14:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c1d4f7e9a302'
down_revision: Union[str, Sequence[str], None] = 'e9f3a1b6c802'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ----------------- legal_documents -----------------
    op.create_table(
        'legal_documents',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column(
            'type',
            sa.Enum('terms_of_use', 'privacy_notice', name='legal_document_type'),
            nullable=False,
        ),
        sa.Column('version', sa.String(length=20), nullable=False),
        sa.Column('file_path', sa.String(length=500), nullable=False),
        sa.Column('sha256', sa.String(length=64), nullable=False),
        sa.Column('published_at', sa.DateTime(), nullable=False),
        sa.Column('is_current', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('vexatious_clauses', sa.JSON(), nullable=True),
        sa.Column('note', sa.Text(), nullable=True),
        sa.UniqueConstraint('type', 'version', name='uq_legal_documents_type_version'),
    )
    # Partial unique index: solo una riga `is_current=true` per ogni `type`.
    # Postgres-specific (postgresql_where). Garantisce a livello DB che non
    # si possano avere due "Terms of Use correnti" o due "Privacy correnti"
    # contemporaneamente: il router admin che pubblica una nuova versione
    # deve mettere a false la vecchia nella stessa transazione.
    op.create_index(
        'uq_legal_documents_one_current_per_type',
        'legal_documents',
        ['type'],
        unique=True,
        postgresql_where=sa.text('is_current = true'),
    )

    # ----------------- consents -----------------
    op.create_table(
        'consents',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column(
            'user_id', sa.Integer(),
            sa.ForeignKey('users.id', ondelete='SET NULL'),
            nullable=True,
        ),
        sa.Column(
            'legal_document_id', sa.Integer(),
            sa.ForeignKey('legal_documents.id', ondelete='RESTRICT'),
            nullable=False,
        ),
        sa.Column('accepted_at', sa.DateTime(), nullable=False),
        sa.Column('ip_address', sa.String(length=45), nullable=True),
        sa.Column('user_agent', sa.Text(), nullable=True),
        sa.Column('method', sa.String(length=50), nullable=False),
        sa.Column(
            'vexatious_clauses_approved',
            sa.Boolean(), nullable=False,
            server_default=sa.text('false'),
        ),
        sa.Column('revoked_at', sa.DateTime(), nullable=True),
        sa.Column('revocation_reason', sa.String(length=100), nullable=True),
    )
    op.create_index('ix_consents_user_id', 'consents', ['user_id'])
    op.create_index('ix_consents_legal_document_id', 'consents', ['legal_document_id'])


def downgrade() -> None:
    op.drop_index('ix_consents_legal_document_id', table_name='consents')
    op.drop_index('ix_consents_user_id', table_name='consents')
    op.drop_table('consents')
    op.drop_index('uq_legal_documents_one_current_per_type', table_name='legal_documents')
    op.drop_table('legal_documents')
    # Pulisci anche il tipo enum creato implicitamente dal create_table sopra:
    # senza questo, se in futuro si rifa l'upgrade Postgres si lamenta
    # "type legal_document_type already exists".
    sa.Enum(name='legal_document_type').drop(op.get_bind(), checkfirst=True)
