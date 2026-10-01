"""Sezioni di un parametro segnate "da completare" (colonna To do)."""
from fastapi import BackgroundTasks
from openpyxl import Workbook

import models
from routers.parameters import (
    ParameterBase, ParameterUpdate, create_admin_parameter, get_admin_parameter,
    get_admin_parameters, update_admin_parameter,
)
from services.excel_export import PARAMETERS_HEADERS, build_schema_workbook
from services.excel_import import import_excel
from services.versioning import serialize_entity
from tests.test_excel_import import _wb_to_bytes


def _admin(db):
    user = models.User(id=1, email="a@b.it", hashed_password="x", name="A", surname="B", role="admin")
    db.add(user)
    db.commit()
    return user


def _update(db, user, pid, needs_work, note="work"):
    p = db.query(models.ParameterDef).filter_by(id=pid).one()
    item = ParameterUpdate(id=pid, name=p.name, position=p.position, needs_work=needs_work, change_note=note)
    update_admin_parameter(pid, item, background_tasks=BackgroundTasks(), db=db, current_user=user)


def test_new_parameter_starts_with_nothing_to_do(db_session):
    user = _admin(db_session)
    create_admin_parameter(ParameterBase(id="P1", name="P1", position=1), db=db_session, current_user=user)
    assert db_session.query(models.ParameterDef).filter_by(id="P1").one().needs_work == []


def test_sections_are_saved_cleaned_and_shown_in_the_list(db_session):
    user = _admin(db_session)
    create_admin_parameter(ParameterBase(id="P1", name="P1", position=1), db=db_session, current_user=user)

    # sezioni sconosciute scartate, doppioni tolti, ordine fisso
    _update(db_session, user, "P1", ["questions", "bogus", "long_description", "questions"])

    assert db_session.query(models.ParameterDef).filter_by(id="P1").one().needs_work == ["long_description", "questions"]
    listed = {p.id: p.needs_work for p in get_admin_parameters(db=db_session, current_user=user)}
    assert listed["P1"] == ["long_description", "questions"]
    detail = get_admin_parameter("P1", db=db_session, current_user=user)
    assert list(detail.needs_work) == ["long_description", "questions"]

    _update(db_session, user, "P1", [])
    assert db_session.query(models.ParameterDef).filter_by(id="P1").one().needs_work == []


def test_history_snapshot_keeps_the_sections_as_a_list(db_session):
    user = _admin(db_session)
    create_admin_parameter(ParameterBase(id="P1", name="P1", position=1), db=db_session, current_user=user)
    _update(db_session, user, "P1", ["short_description"])

    p = db_session.query(models.ParameterDef).filter_by(id="P1").one()
    assert serialize_entity(p)["needs_work"] == ["short_description"]
    last = (
        db_session.query(models.EntityVersion)
        .filter_by(entity_type="parameter", entity_id="P1")
        .order_by(models.EntityVersion.id.desc())
        .first()
    )
    assert last.snapshot["needs_work"] == ["short_description"]


def test_excel_neither_exports_nor_clears_the_sections(db_session):
    user = _admin(db_session)
    create_admin_parameter(ParameterBase(id="P1", name="P1", position=1), db=db_session, current_user=user)
    _update(db_session, user, "P1", ["long_description"])

    exported = build_schema_workbook(db_session)
    headers = [c.value for c in exported["Parameters"][1]]
    assert not any("work" in str(h).lower() for h in headers)

    wb = Workbook()
    wb.remove(wb.active)
    ws = wb.create_sheet("Parameters")
    ws.append(PARAMETERS_HEADERS)
    ws.append(["P1", 1, "Renamed by Excel", "", "", "", "", "", None, "", "Yes"])
    import_excel(db_session, _wb_to_bytes(wb), user.id)
    db_session.commit()

    p = db_session.query(models.ParameterDef).filter_by(id="P1").one()
    assert p.name == "Renamed by Excel"
    assert p.needs_work == ["long_description"]
