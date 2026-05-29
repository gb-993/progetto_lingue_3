"""whats_new_views

Crea la tabella `whats_new_views`: traccia, per utente, l'ultima versione di
"What's New" gia' vista (= site_contents.updated_at della riga key='whats_new').

Sostituisce il vecchio tracciamento per-browser in localStorage con un
tracciamento per-utente lato server: cosi' il banner si vede "una volta" per
utente su qualsiasi dispositivo, come avviene per i documenti legali.

Revision ID: d9f2b4e6c1a3
Revises: c5d8e1f3a407
Create Date: 2026-05-29 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd9f2b4e6c1a3'
down_revision: Union[str, Sequence[str], None] = 'c5d8e1f3a407'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'whats_new_views',
        sa.Column(
            'user_id', sa.Integer(),
            sa.ForeignKey('users.id', ondelete='CASCADE'),
            primary_key=True,
        ),
        sa.Column('seen_version', sa.DateTime(), nullable=False),
        sa.Column('seen_at', sa.DateTime(), nullable=False),
    )

    # --- Backfill di transizione ---
    # Prima d'ora il "gia' visto" stava in localStorage (per-browser). Passando
    # al tracciamento server-side la tabella nasce vuota: senza questo backfill
    # TUTTI gli utenti rivedrebbero il banner una volta dopo il deploy, anche
    # chi l'aveva gia' chiuso. Marchiamo quindi ogni utente esistente come
    # "ha gia' visto la versione corrente" (se ne esiste una pubblicata).
    # Effetto: nessuna ricomparsa al deploy; il banner tornera' a comparire
    # (una volta) solo alla PROSSIMA pubblicazione del super-admin, che bumpa
    # site_contents.updated_at oltre il seen_version qui salvato.
    # Se non c'e' ancora contenuto 'whats_new' (updated_at NULL) non inserisce
    # nulla: la prima pubblicazione futura lo mostrera' correttamente a tutti.
    op.execute(
        """
        INSERT INTO whats_new_views (user_id, seen_version, seen_at)
        SELECT u.id, sc.updated_at, now()
        FROM users u
        CROSS JOIN site_contents sc
        WHERE sc.key = 'whats_new' AND sc.updated_at IS NOT NULL
        """
    )


def downgrade() -> None:
    op.drop_table('whats_new_views')
