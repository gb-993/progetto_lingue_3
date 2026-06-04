"""Test unit del resolver `resolve_parameter`."""
import models
from services.parameter_alias import resolve_parameter


def _make_param(db, pid: str) -> models.ParameterDef:
    p = models.ParameterDef(id=pid, name=f"P {pid}", position=1, is_active=True)
    db.add(p)
    db.commit()
    return p


def test_resolve_by_current_id_no_alias(db_session):
    _make_param(db_session, "P1")
    res = resolve_parameter(db_session, "P1")
    assert res.parameter is not None
    assert res.parameter.id == "P1"
    assert res.matched_via_alias is False


def test_resolve_by_alias(db_session):
    _make_param(db_session, "P1")
    db_session.add(models.ParameterAlias(parameter_id="P1", old_id="POLD"))
    db_session.commit()
    res = resolve_parameter(db_session, "POLD")
    assert res.parameter is not None
    assert res.parameter.id == "P1"
    assert res.matched_via_alias is True


def test_resolve_orphan_alias_returns_none(db_session):
    # db_session non ha FK enforcement: alias che punta a un parametro inesistente.
    db_session.add(models.ParameterAlias(parameter_id="GONE", old_id="POLD"))
    db_session.commit()
    assert resolve_parameter(db_session, "POLD").parameter is None


def test_resolve_unknown_returns_none(db_session):
    _make_param(db_session, "P1")
    res = resolve_parameter(db_session, "ZZ")
    assert res.parameter is None
    assert res.matched_via_alias is False


def test_resolve_empty_returns_none(db_session):
    assert resolve_parameter(db_session, "").parameter is None
