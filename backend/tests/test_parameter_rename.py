"""Test del flusso di rename di ParameterDef.id.

Verifica:
  - rename via PUT salva l'alias storico
  - cascata DB sui figli (questions, language_parameters,
    language_parameter_statuses, parameter_change_logs) via ON UPDATE CASCADE
  - RISCRITTURA delle formule degli altri parametri che citano il vecchio id
    (token-aware: non tocca P10/P12 quando rinomino P1)
  - validazioni: id vuoto / troppo lungo / charset / gia' in uso / alias altrui
  - rename A->B->A rimuove l'alias auto-referenziale
  - excel import (sheet Parameters) riconosce un id obsoleto via alias
"""
import io

import pytest
from fastapi import BackgroundTasks, HTTPException
from openpyxl import Workbook
from sqlalchemy import text

import models
from routers.parameters import update_admin_parameter, ParameterUpdate
from services.logic_parser import validate_expression


@pytest.fixture
def db_fk(db_session):
    db_session.execute(text("PRAGMA foreign_keys = ON"))
    return db_session


def _admin(db) -> models.User:
    u = models.User(id=1, email="a@b.it", hashed_password="x", name="A", surname="B", role="admin")
    db.add(u)
    db.commit()
    return u


def _seed_param(db, pid: str, cond=None, position: int = 1) -> models.ParameterDef:
    p = models.ParameterDef(id=pid, name=f"P {pid}", position=position, is_active=True,
                            implicational_condition=cond)
    db.add(p)
    db.commit()
    return p


def _put_item(p: models.ParameterDef, new_id: str, cond="__keep__") -> ParameterUpdate:
    return ParameterUpdate(
        id=new_id,
        name=p.name,
        position=p.position,
        implicational_condition=(p.implicational_condition if cond == "__keep__" else cond),
        change_note="rename test",
    )


def _put(db, old_id, item, user):
    return update_admin_parameter(old_id, item, background_tasks=BackgroundTasks(), db=db, current_user=user)


# ---------------------------------------------------------------------------
# alias + cascade
# ---------------------------------------------------------------------------

def test_rename_creates_alias(db_fk):
    user = _admin(db_fk)
    p = _seed_param(db_fk, "P1")
    _put(db_fk, "P1", _put_item(p, "PX"), user)

    assert db_fk.query(models.ParameterDef).filter_by(id="PX").count() == 1
    assert db_fk.query(models.ParameterDef).filter_by(id="P1").count() == 0
    aliases = db_fk.query(models.ParameterAlias).filter_by(parameter_id="PX").all()
    assert len(aliases) == 1 and aliases[0].old_id == "P1"


def test_rename_cascades_on_children(db_fk):
    user = _admin(db_fk)
    p = _seed_param(db_fk, "P1")
    db_fk.add(models.Language(id="ENG", name_full="English", position=1))
    db_fk.add(models.Question(id="P1_Qa", parameter_id="P1", text="?"))
    db_fk.add(models.LanguageParameter(language_id="ENG", parameter_id="P1", value_orig="+"))
    db_fk.add(models.LanguageParameterStatus(language_id="ENG", parameter_id="P1", is_unsure=False))
    db_fk.add(models.ParameterChangeLog(parameter_id="P1", user_id=user.id, change_note="seed"))
    db_fk.commit()

    _put(db_fk, "P1", _put_item(p, "PX"), user)

    assert db_fk.query(models.Question).filter_by(parameter_id="PX").count() == 1
    assert db_fk.query(models.LanguageParameter).filter_by(parameter_id="PX").count() == 1
    assert db_fk.query(models.LanguageParameterStatus).filter_by(parameter_id="PX").count() == 1
    # i log preesistenti seguono via cascade; nessun figlio resta sul vecchio id
    assert db_fk.query(models.Question).filter_by(parameter_id="P1").count() == 0
    assert db_fk.query(models.LanguageParameter).filter_by(parameter_id="P1").count() == 0
    assert db_fk.query(models.ParameterChangeLog).filter_by(parameter_id="P1").count() == 0


# ---------------------------------------------------------------------------
# RISCRITTURA FORMULE — il cuore
# ---------------------------------------------------------------------------

def test_rename_rewrites_formulas_in_other_params(db_fk):
    user = _admin(db_fk)
    p1 = _seed_param(db_fk, "P1", position=1)
    _seed_param(db_fk, "P2", cond="+P1", position=2)
    _seed_param(db_fk, "P3", cond="+P1 & -P2", position=3)
    _seed_param(db_fk, "P10", position=4)               # foglia, citata sotto
    _seed_param(db_fk, "P5", cond="+P10 | +P1", position=5)

    _put(db_fk, "P1", _put_item(p1, "PX"), user)

    p2 = db_fk.query(models.ParameterDef).filter_by(id="P2").one()
    p3 = db_fk.query(models.ParameterDef).filter_by(id="P3").one()
    p5 = db_fk.query(models.ParameterDef).filter_by(id="P5").one()
    assert p2.implicational_condition == "+PX"
    assert p3.implicational_condition == "+PX & -P2"
    # P10 NON deve essere toccato (P1 e' solo sottostringa di P10)
    assert p5.implicational_condition == "+P10 | +PX"
    # tutte le formule riscritte restano valide
    for c in (p2.implicational_condition, p3.implicational_condition, p5.implicational_condition):
        validate_expression(c)


def test_rename_logs_formula_rewrite(db_fk):
    user = _admin(db_fk)
    p1 = _seed_param(db_fk, "P1", position=1)
    _seed_param(db_fk, "P2", cond="+P1", position=2)
    _put(db_fk, "P1", _put_item(p1, "PX"), user)
    # P2 deve avere un log automatico della riscrittura
    logs = db_fk.query(models.ParameterChangeLog).filter_by(parameter_id="P2").all()
    assert any("Formula updated" in l.change_note for l in logs)


# ---------------------------------------------------------------------------
# validazioni
# ---------------------------------------------------------------------------

def test_rename_empty_rejected(db_fk):
    user = _admin(db_fk)
    p = _seed_param(db_fk, "P1")
    with pytest.raises(HTTPException) as e:
        _put(db_fk, "P1", _put_item(p, "   "), user)
    assert e.value.status_code == 422


def test_rename_too_long_rejected(db_fk):
    user = _admin(db_fk)
    p = _seed_param(db_fk, "P1")
    with pytest.raises(HTTPException) as e:
        _put(db_fk, "P1", _put_item(p, "X" * 11), user)
    assert e.value.status_code == 422


def test_rename_invalid_charset_rejected(db_fk):
    user = _admin(db_fk)
    p = _seed_param(db_fk, "P1")
    with pytest.raises(HTTPException) as e:
        _put(db_fk, "P1", _put_item(p, "P-1"), user)
    assert e.value.status_code == 422


def test_rename_to_existing_rejected(db_fk):
    user = _admin(db_fk)
    p = _seed_param(db_fk, "P1")
    _seed_param(db_fk, "P2", position=2)
    with pytest.raises(HTTPException) as e:
        _put(db_fk, "P1", _put_item(p, "P2"), user)
    assert e.value.status_code == 409


def test_rename_to_alias_of_other_rejected(db_fk):
    user = _admin(db_fk)
    _seed_param(db_fk, "PA")
    db_fk.add(models.ParameterAlias(parameter_id="PA", old_id="POLD"))
    b = _seed_param(db_fk, "PB", position=2)
    db_fk.commit()
    with pytest.raises(HTTPException) as e:
        _put(db_fk, "PB", _put_item(b, "POLD"), user)
    assert e.value.status_code == 409


# ---------------------------------------------------------------------------
# ciclo A->B->A
# ---------------------------------------------------------------------------

def test_rename_cycle_removes_self_alias(db_fk):
    user = _admin(db_fk)
    p = _seed_param(db_fk, "P1")
    _put(db_fk, "P1", _put_item(p, "PX"), user)
    p2 = db_fk.query(models.ParameterDef).filter_by(id="PX").one()
    _put(db_fk, "PX", _put_item(p2, "P1"), user)

    aliases = db_fk.query(models.ParameterAlias).filter_by(parameter_id="P1").all()
    old_ids = sorted(a.old_id for a in aliases)
    assert "PX" in old_ids
    assert "P1" not in old_ids


# ---------------------------------------------------------------------------
# excel import via alias
# ---------------------------------------------------------------------------

def _build_params_xlsx(rows: list[dict]) -> bytes:
    wb = Workbook()
    wb.remove(wb.active)
    ws = wb.create_sheet("Parameters")
    ws.append(["ID", "Name"])
    for r in rows:
        ws.append([r.get("ID"), r.get("Name", "")])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_excel_import_parameters_uses_alias(db_fk):
    from services.excel_import import import_excel
    user = _admin(db_fk)
    _seed_param(db_fk, "P1")
    db_fk.add(models.ParameterAlias(parameter_id="P1", old_id="POLD"))
    db_fk.commit()

    data = _build_params_xlsx([{"ID": "POLD", "Name": "Renamed name"}])
    import_excel(db_fk, data, user.id, create_missing=True)
    db_fk.commit()

    params = db_fk.query(models.ParameterDef).all()
    assert len(params) == 1
    assert params[0].id == "P1"            # id corrente, non duplicato
    assert params[0].name == "Renamed name"
