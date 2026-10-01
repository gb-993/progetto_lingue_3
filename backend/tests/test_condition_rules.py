"""Regole sulle condizioni: parametri citati, parametri spenti, giri chiusi."""
import pytest
from fastapi import BackgroundTasks, HTTPException
from openpyxl import Workbook

import models
from routers.parameters import (
    ConditionCheck, ParameterBase, ParameterUpdate,
    create_admin_parameter, reactivate_parameter, update_admin_parameter, validate_condition_api,
)
from services.condition_rules import (
    ConditionError, check_condition, extract_refs, find_cycles, find_dependency_path, rejected_changes,
)
from services.excel_export import PARAMETERS_HEADERS
from services.excel_import import import_excel
from tests.test_excel_import import _wb_to_bytes


def _admin(db) -> models.User:
    user = models.User(id=1, email="a@b.it", hashed_password="x", name="A", surname="B", role="admin")
    db.add(user)
    db.commit()
    return user


def _param(db, pid, cond=None, active=True) -> models.ParameterDef:
    p = models.ParameterDef(id=pid, name=f"P {pid}", position=1, is_active=active, implicational_condition=cond)
    db.add(p)
    db.commit()
    return p


def test_extract_refs():
    assert extract_refs("+FGM & (not -sco | 0ABC)") == {"FGM", "SCO", "ABC"}
    assert extract_refs(None) == set()


def test_find_dependency_path_and_cycles():
    deps = {"A": {"B"}, "B": {"C"}, "C": {"A"}, "D": {"A"}, "E": set()}
    assert find_dependency_path(deps, "A", "A") == ["A", "B", "C", "A"]
    assert find_dependency_path(deps, "D", "D") is None
    assert find_cycles(deps) == [["A", "B", "C", "A"]]
    assert find_cycles({"A": {"B"}, "B": set()}) == []


def test_valid_condition_is_accepted(db_session):
    _param(db_session, "A")
    _param(db_session, "B")
    check_condition(db_session, "C", "+A & -B")
    check_condition(db_session, "C", None)
    check_condition(db_session, "C", "   ")


def test_wrong_syntax_is_rejected(db_session):
    with pytest.raises(ConditionError, match="Wrong formula syntax"):
        check_condition(db_session, "C", "((( +A")


def test_unknown_parameter_is_rejected(db_session):
    _param(db_session, "SCO")
    with pytest.raises(ConditionError, match="do not exist: SC0"):
        check_condition(db_session, "C", "+SC0")


def test_active_parameter_cannot_cite_a_deactivated_one(db_session):
    _param(db_session, "A", active=False)
    with pytest.raises(ConditionError, match="deactivated parameters: A"):
        check_condition(db_session, "C", "+A", is_active=True)
    # un parametro spento può citarne uno spento: conta quando lo si riaccende
    check_condition(db_session, "C", "+A", is_active=False)


def test_parameter_cannot_cite_itself(db_session):
    _param(db_session, "A")
    with pytest.raises(ConditionError, match="its own condition"):
        check_condition(db_session, "A", "+A")
    # nemmeno col nuovo id, durante una rinomina
    with pytest.raises(ConditionError, match="its own condition"):
        check_condition(db_session, "A", "+AX", other_own_ids=["AX"])


def test_cycle_is_rejected_and_shown(db_session):
    _param(db_session, "A")
    _param(db_session, "B", cond="+A")
    _param(db_session, "C", cond="+B")
    with pytest.raises(ConditionError, match="A → C → B → A"):
        check_condition(db_session, "A", "-C")


def test_create_with_cycle_is_blocked(db_session):
    user = _admin(db_session)
    _param(db_session, "B", cond="+NEW", active=False)
    item = ParameterBase(id="NEW", name="New", position=2, implicational_condition="+B", is_active=False)
    with pytest.raises(HTTPException) as exc:
        create_admin_parameter(item, db=db_session, current_user=user)
    assert exc.value.status_code == 400
    assert "circular dependency" in exc.value.detail
    assert db_session.query(models.ParameterDef).filter_by(id="NEW").count() == 0


def test_update_with_cycle_is_blocked(db_session):
    user = _admin(db_session)
    a = _param(db_session, "A")
    _param(db_session, "B", cond="+A")
    item = ParameterUpdate(id="A", name=a.name, position=1, implicational_condition="+B", change_note="x")
    with pytest.raises(HTTPException) as exc:
        update_admin_parameter("A", item, background_tasks=BackgroundTasks(), db=db_session, current_user=user)
    assert exc.value.status_code == 400
    assert "A → B → A" in exc.value.detail
    db_session.rollback()
    assert db_session.query(models.ParameterDef).filter_by(id="A").one().implicational_condition is None


def test_reactivate_is_blocked_while_citing_a_deactivated_parameter(db_session):
    user = _admin(db_session)
    _param(db_session, "A", active=False)
    _param(db_session, "B", cond="+A", active=False)
    with pytest.raises(HTTPException) as exc:
        reactivate_parameter("B", background_tasks=BackgroundTasks(), db=db_session, current_user=user)
    assert exc.value.status_code == 400
    assert "deactivated parameters: A" in exc.value.detail
    assert db_session.query(models.ParameterDef).filter_by(id="B").one().is_active is False

    reactivate_parameter("A", background_tasks=BackgroundTasks(), db=db_session, current_user=user)
    reactivate_parameter("B", background_tasks=BackgroundTasks(), db=db_session, current_user=user)
    assert db_session.query(models.ParameterDef).filter_by(id="B").one().is_active is True


def test_live_validation_reports_the_same_problems(db_session):
    user = _admin(db_session)
    _param(db_session, "A")
    _param(db_session, "B", cond="+A")
    ok = validate_condition_api(ConditionCheck(condition="+B", param_id="C"), db=db_session, current_user=user)
    assert ok == {"valid": True, "error": None}
    bad = validate_condition_api(ConditionCheck(condition="+B", param_id="A"), db=db_session, current_user=user)
    assert bad["valid"] is False and "circular dependency" in bad["error"]


def test_rejected_changes_two_rows_forming_a_cycle():
    current = {"A": (None, True), "B": (None, True), "C": (None, True)}
    planned = {"A": ("+B", True), "B": ("+A", True), "C": ("+A", True)}
    rejected = rejected_changes(current, planned)
    assert set(rejected) == {"A", "B"}
    assert rejected["A"][0] == "condition" and "circular dependency" in rejected["A"][1]


def test_rejected_changes_blames_the_row_that_deactivates():
    current = {"A": (None, True), "B": ("+A", True)}
    rejected = rejected_changes(current, {"A": (None, False)})
    assert rejected == {"A": ("is_active", "Cannot deactivate: the parameter is used in the condition of active parameter B.")}
    # spegnerli insieme va bene
    assert rejected_changes(current, {"A": (None, False), "B": ("+A", False)}) == {}


def test_rejected_changes_ignores_problems_already_there():
    current = {"A": (None, False), "B": ("+A", True), "C": (None, True)}
    assert rejected_changes(current, {"C": (None, True)}) == {}


def _parameters_sheet(rows):
    wb = Workbook()
    wb.remove(wb.active)
    ws = wb.create_sheet("Parameters")
    ws.append(PARAMETERS_HEADERS)
    for pid, cond, active in rows:
        ws.append([pid, 1, f"Imported {pid}", "", "", "", "", "", cond, "", "Yes" if active else "No"])
    return _wb_to_bytes(wb)


def test_excel_import_rejects_rows_that_would_break_the_values(db_session):
    user = _admin(db_session)
    for pid in ("A", "B", "C", "D"):
        _param(db_session, pid)
    _param(db_session, "E", cond="+D")

    report = import_excel(db_session, _parameters_sheet([
        ("A", "+B", True),       # giro con B
        ("B", "+A", True),
        ("C", "+ZZZ", True),     # parametro inesistente
        ("D", None, False),      # spento, ma E lo cita
    ]), user.id)
    db_session.commit()

    reasons = {(e.row, e.column): e.reason for e in report.errors}
    assert "circular dependency" in reasons[(2, "Implicational Condition")]
    assert "circular dependency" in reasons[(3, "Implicational Condition")]
    assert "do not exist: ZZZ" in reasons[(4, "Implicational Condition")]
    assert "Cannot deactivate" in reasons[(5, "Is Active")]

    params = {p.id: p for p in db_session.query(models.ParameterDef).all()}
    assert params["A"].implicational_condition is None and params["A"].name == "P A"
    assert params["C"].implicational_condition is None
    assert params["D"].is_active is True


def test_excel_import_accepts_a_consistent_sheet(db_session):
    user = _admin(db_session)
    for pid in ("A", "B", "C"):
        _param(db_session, pid)

    # C cita B, che lo stesso foglio riattiva e modifica: conta lo stato finale
    db_session.query(models.ParameterDef).filter_by(id="B").update({"is_active": False})
    db_session.commit()
    report = import_excel(db_session, _parameters_sheet([
        ("C", "+B & -A", True),
        ("B", "+A", True),
        ("A", None, True),
    ]), user.id)
    db_session.commit()

    assert report.errors == []
    params = {p.id: p for p in db_session.query(models.ParameterDef).all()}
    assert params["C"].implicational_condition == "+B & -A"
    assert params["B"].is_active is True


def test_restore_mode_keeps_the_file_as_it_is(db_session):
    user = _admin(db_session)
    # nel restore il file va ripreso com'è: ci pensa il calcolo a dichiarare i '?'
    report = import_excel(db_session, _parameters_sheet([
        ("A", "+B", True),
        ("B", "+A", True),
    ]), user.id, create_missing=True)
    db_session.commit()
    assert report.errors == []
    assert db_session.query(models.ParameterDef).count() == 2
