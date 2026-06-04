"""abilita ON UPDATE CASCADE sulle FK verso parameter_defs.id

Permette di rinominare l'id di un ParameterDef: Postgres propaga il nuovo
valore alle tabelle figlie (questions, language_parameters,
language_parameter_statuses, parameter_change_logs) nella stessa transazione.

NOTA: a differenza di languages/questions, i parametri si citano per id dentro
le formule `implicational_condition` di altri parametri. Quei riferimenti sono
testo libero e NON seguono la cascade: vengono riscritti a livello applicativo
nel PUT del parametro (vedi routers/parameters.py).

Revision ID: a7c3e5f9b201
Revises: f2b3d4e5a607
Create Date: 2026-06-04 01:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'a7c3e5f9b201'
down_revision: Union[str, Sequence[str], None] = 'f2b3d4e5a607'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# FK create da SQLAlchemy senza nome esplicito -> default Postgres
# `<table>_<column>_fkey`. Nessuna delle quattro ha ondelete preesistente.
FK_LIST = [
    # (constraint_name, source_table)
    ("questions_parameter_id_fkey", "questions"),
    ("language_parameters_parameter_id_fkey", "language_parameters"),
    ("language_parameter_statuses_parameter_id_fkey", "language_parameter_statuses"),
    ("parameter_change_logs_parameter_id_fkey", "parameter_change_logs"),
]


def upgrade() -> None:
    for fk_name, table in FK_LIST:
        op.drop_constraint(fk_name, table, type_="foreignkey")
        op.create_foreign_key(
            fk_name,
            table,
            "parameter_defs",
            ["parameter_id"],
            ["id"],
            onupdate="CASCADE",
        )


def downgrade() -> None:
    for fk_name, table in FK_LIST:
        op.drop_constraint(fk_name, table, type_="foreignkey")
        op.create_foreign_key(
            fk_name,
            table,
            "parameter_defs",
            ["parameter_id"],
            ["id"],
        )
