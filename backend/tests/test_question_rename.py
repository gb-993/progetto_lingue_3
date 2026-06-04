"""Test del flusso di rename di Question.id.

Verifica:
  - rename via PUT salva l'alias storico
  - cascata DB sui figli (answers, question_allowed_motivations): grazie alle
    FK `ON UPDATE CASCADE`. Su SQLite richiede `PRAGMA foreign_keys = ON`
  - validazioni: id vuoto / troppo lungo / gia' in uso / gia' alias di altra domanda
  - rename A->B->A rimuove l'alias auto-referenziale
  - excel import (sheet Questions) riconosce un id obsoleto via alias e aggiorna
    la domanda corrente senza duplicare
"""
import io

import pytest
from fastapi import BackgroundTasks, HTTPException
from openpyxl import Workbook
from sqlalchemy import text

import models
from routers.questions import update_admin_question, QuestionUpdate


# ----------------------------------------------------------------------------
# Helpers / fixture
# ----------------------------------------------------------------------------

@pytest.fixture
def db_fk(db_session):
    """Abilita FOREIGN_KEYS su SQLite in-memory (di default e' off).
    Necessario per esercitare la cascade ON UPDATE/DELETE.
    """
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
    """Payload PUT identico alla question, cambiando solo l'id."""
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


# ----------------------------------------------------------------------------
# PUT — rename salvato come alias
# ----------------------------------------------------------------------------

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

    # Rename mantenendo la motivation tra le allowed: l'answer segue via cascade,
    # la QAM viene ricreata sul nuovo id.
    _put(db_fk, "P1_Qa", _put_item_from(q, "P1_Qb", allowed=[mot.id]), user)

    assert db_fk.query(models.Answer).filter_by(question_id="P1_Qb").count() == 1
    assert db_fk.query(models.Answer).filter_by(question_id="P1_Qa").count() == 0
    assert db_fk.query(models.QuestionAllowedMotivation).filter_by(question_id="P1_Qb").count() == 1
    assert db_fk.query(models.QuestionAllowedMotivation).filter_by(question_id="P1_Qa").count() == 0


# ----------------------------------------------------------------------------
# PUT — validazioni
# ----------------------------------------------------------------------------

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
    # Domanda A con alias "P1_OLD"
    a = _seed_question(db_fk, "P1_Qa")
    db_fk.add(models.QuestionAlias(question_id="P1_Qa", old_id="P1_OLD"))
    # Domanda B
    b = models.Question(id="P1_Qb", parameter_id="P1", text="B")
    db_fk.add(b)
    db_fk.commit()
    # Rinomino B in "P1_OLD" -> conflitto con alias di A
    with pytest.raises(HTTPException) as exc:
        _put(db_fk, "P1_Qb", _put_item_from(b, "P1_OLD"), user)
    assert exc.value.status_code == 409


# ----------------------------------------------------------------------------
# PUT — rename ciclico A -> B -> A
# ----------------------------------------------------------------------------

def test_rename_cycle_removes_self_alias(db_fk):
    user = _admin(db_fk)
    q = _seed_question(db_fk, "P1_Qa")

    _put(db_fk, "P1_Qa", _put_item_from(q, "P1_Qb"), user)
    q2 = db_fk.query(models.Question).filter_by(id="P1_Qb").one()
    _put(db_fk, "P1_Qb", _put_item_from(q2, "P1_Qa"), user)

    # Stato finale: id corrente "P1_Qa", alias "P1_Qb" presente, nessun alias "P1_Qa"
    aliases = db_fk.query(models.QuestionAlias).filter_by(question_id="P1_Qa").all()
    old_ids = sorted(a.old_id for a in aliases)
    assert "P1_Qb" in old_ids
    assert "P1_Qa" not in old_ids


# ----------------------------------------------------------------------------
# Excel import — alias lookup, no duplicati
# ----------------------------------------------------------------------------

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
    """Excel con id obsoleto deve aggiornare la domanda corrente, non duplicarla."""
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
    assert qs[0].id == "P1_Qa"  # id corrente, non duplicato dall'old id del file
    assert qs[0].text == "Updated text"  # testo aggiornato
