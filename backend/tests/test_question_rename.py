import io

import pytest
from fastapi import BackgroundTasks, HTTPException
from openpyxl import Workbook
from sqlalchemy import text

import models
from routers.questions import update_admin_question, QuestionUpdate


@pytest.fixture
def db_fk(db_session):
    """Attiva le FK su SQLite (spente di default): servono per le cascade."""
    db_session.execute(text("PRAGMA foreign_keys = ON"))
    return db_session


def _admin(db) -> models.User:
    u = models.User(
        id=1, email="a@b.it", hashed_password="x",
        name="Ad", surname="Min", role="admin",
    )
    db.add(u)
    db.commit()
    return u


def _seed_question(db, qid: str = "P1_Qa") -> models.Question:
    param = db.query(models.ParameterDef).filter_by(id="P1").first()
    if param is None:
        param = models.ParameterDef(id="P1", position=1, name="P", is_active=True)
        db.add(param)
        db.flush()
    q = models.Question(id=qid, parameter_id="P1", text="Original?")
    db.add(q)
    db.commit()
    return q


def _put_item_from(q: models.Question, new_id: str, allowed=None) -> QuestionUpdate:
    """Payload PUT uguale alla question, cambia solo l'id."""
    return QuestionUpdate(
        id=new_id,
        parameter_id=q.parameter_id,
        text=q.text,
        instruction=q.instruction,
        instruction_yes=q.instruction_yes,
        instruction_no=q.instruction_no,
        example_yes=q.example_yes,
        help_info=q.help_info,
        is_stop_question=q.is_stop_question or False,
        is_active=q.is_active if q.is_active is not None else True,
        allowed_motivations=allowed or [],
        change_note="rename test",
        wipe_data=False,
    )


def _put(db, old_id, item, user):
    return update_admin_question(
        old_id, item, background_tasks=BackgroundTasks(), db=db, current_user=user,
    )


def test_rename_creates_alias(db_fk):
    user = _admin(db_fk)
    q = _seed_question(db_fk, "P1_Qa")

    _put(db_fk, "P1_Qa", _put_item_from(q, "P1_Qb"), user)

    assert db_fk.query(models.Question).filter_by(id="P1_Qb").count() == 1
    assert db_fk.query(models.Question).filter_by(id="P1_Qa").count() == 0
    aliases = db_fk.query(models.QuestionAlias).filter_by(question_id="P1_Qb").all()
    assert len(aliases) == 1
    assert aliases[0].old_id == "P1_Qa"


def test_rename_cascades_on_children(db_fk):
    user = _admin(db_fk)
    q = _seed_question(db_fk, "P1_Qa")
    db_fk.add(models.Language(id="ENG", name_full="English", position=1))
    mot = models.Motivation(code="MOT001", label="m")
    db_fk.add(mot)
    db_fk.flush()
    db_fk.add(models.Answer(language_id="ENG", question_id="P1_Qa", response_text="yes"))
    db_fk.add(models.QuestionAllowedMotivation(question_id="P1_Qa", motivation_id=mot.id))
    db_fk.commit()

    # l'answer segue via cascade, la QAM viene ricreata
    _put(db_fk, "P1_Qa", _put_item_from(q, "P1_Qb", allowed=[mot.id]), user)

    assert db_fk.query(models.Answer).filter_by(question_id="P1_Qb").count() == 1
    assert db_fk.query(models.Answer).filter_by(question_id="P1_Qa").count() == 0
    assert db_fk.query(models.QuestionAllowedMotivation).filter_by(question_id="P1_Qb").count() == 1
    assert db_fk.query(models.QuestionAllowedMotivation).filter_by(question_id="P1_Qa").count() == 0


def test_rename_empty_id_rejected(db_fk):
    user = _admin(db_fk)
    q = _seed_question(db_fk, "P1_Qa")
    with pytest.raises(HTTPException) as exc:
        _put(db_fk, "P1_Qa", _put_item_from(q, "   "), user)
    assert exc.value.status_code == 422


def test_rename_too_long_rejected(db_fk):
    user = _admin(db_fk)
    q = _seed_question(db_fk, "P1_Qa")
    with pytest.raises(HTTPException) as exc:
        _put(db_fk, "P1_Qa", _put_item_from(q, "X" * 41), user)
    assert exc.value.status_code == 422


def test_rename_to_existing_id_rejected(db_fk):
    user = _admin(db_fk)
    q = _seed_question(db_fk, "P1_Qa")
    db_fk.add(models.Question(id="P1_Qb", parameter_id="P1", text="other"))
    db_fk.commit()
    with pytest.raises(HTTPException) as exc:
        _put(db_fk, "P1_Qa", _put_item_from(q, "P1_Qb"), user)
    assert exc.value.status_code == 409


def test_rename_to_alias_of_other_question_rejected(db_fk):
    user = _admin(db_fk)
    a = _seed_question(db_fk, "P1_Qa")
    db_fk.add(models.QuestionAlias(question_id="P1_Qa", old_id="P1_OLD"))
    b = models.Question(id="P1_Qb", parameter_id="P1", text="B")
    db_fk.add(b)
    db_fk.commit()
    # "P1_OLD" è già alias di A
    with pytest.raises(HTTPException) as exc:
        _put(db_fk, "P1_Qb", _put_item_from(b, "P1_OLD"), user)
    assert exc.value.status_code == 409


def test_rename_cycle_removes_self_alias(db_fk):
    user = _admin(db_fk)
    q = _seed_question(db_fk, "P1_Qa")

    _put(db_fk, "P1_Qa", _put_item_from(q, "P1_Qb"), user)
    q2 = db_fk.query(models.Question).filter_by(id="P1_Qb").one()
    _put(db_fk, "P1_Qb", _put_item_from(q2, "P1_Qa"), user)

    aliases = db_fk.query(models.QuestionAlias).filter_by(question_id="P1_Qa").all()
    old_ids = sorted(a.old_id for a in aliases)
    assert "P1_Qb" in old_ids
    assert "P1_Qa" not in old_ids


def _build_questions_xlsx(rows: list[dict]) -> bytes:
    wb = Workbook()
    wb.remove(wb.active)
    ws = wb.create_sheet("Questions")
    headers = ["ID", "Parameter ID", "Text"]
    ws.append(headers)
    for r in rows:
        ws.append([r.get("ID"), r.get("Parameter ID"), r.get("Text", "")])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_excel_import_questions_uses_alias(db_fk):
    """Id vecchio nel file: aggiorna la domanda, non la duplica."""
    from services.excel_import import import_excel
    user = _admin(db_fk)
    _seed_question(db_fk, "P1_Qa")
    db_fk.add(models.QuestionAlias(question_id="P1_Qa", old_id="P1_OLD"))
    db_fk.commit()

    data = _build_questions_xlsx([
        {"ID": "P1_OLD", "Parameter ID": "P1", "Text": "Updated text"}
    ])
    import_excel(db_fk, data, user.id, create_missing=True)
    db_fk.commit()

    qs = db_fk.query(models.Question).all()
    assert len(qs) == 1
    assert qs[0].id == "P1_Qa"  # resta l'id corrente
    assert qs[0].text == "Updated text"
