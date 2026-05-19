"""Test dell'endpoint GET /api/queries/q11 (question senza risposta per lingua).

Definizione operativa di "senza risposta":
  - non esiste una row in `answers` per quella combinazione (lingua, question), OPPURE
  - esiste una row in `answers` ma con `response_text IS NULL`

'unsure' e' considerata una risposta data: la sua question NON rientra.

Scope: solo question con is_active=True di parametri con is_active=True.
"""
import pytest
from fastapi import HTTPException
from sqlalchemy import text

import models
from routers.queries import query_11_unanswered


@pytest.fixture
def db_fk(db_session):
    db_session.execute(text("PRAGMA foreign_keys = ON"))
    return db_session


def _seed_base(db):
    """Setup: 1 lingua + 2 parametri attivi + 1 parametro disattivato."""
    db.add(models.Language(id="ENG", name_full="English", position=1))

    db.add(models.ParameterDef(id="P_ACT_1", position=1, name="Active 1", is_active=True))
    db.add(models.ParameterDef(id="P_ACT_2", position=2, name="Active 2", is_active=True))
    db.add(models.ParameterDef(id="P_OFF", position=3, name="Disabled", is_active=False))

    # 4 question attive su parametri attivi (le useremo nei vari scenari)
    db.add(models.Question(id="Q_NO_ROW", parameter_id="P_ACT_1", text="No row in answers", is_active=True))
    db.add(models.Question(id="Q_NULL", parameter_id="P_ACT_1", text="Has row but NULL", is_active=True))
    db.add(models.Question(id="Q_YES", parameter_id="P_ACT_2", text="Answered yes", is_active=True))
    db.add(models.Question(id="Q_NO", parameter_id="P_ACT_2", text="Answered no", is_active=True))
    db.add(models.Question(id="Q_UNSURE", parameter_id="P_ACT_2", text="Answered unsure", is_active=True))

    # 1 question DISATTIVATA su parametro attivo (deve essere esclusa anche se senza risposta)
    db.add(models.Question(id="Q_INACTIVE", parameter_id="P_ACT_1", text="Inactive question", is_active=False))

    # 1 question ATTIVA su parametro DISATTIVATO (deve essere esclusa)
    db.add(models.Question(id="Q_ORPHAN", parameter_id="P_OFF", text="Active q in off param", is_active=True))

    # Answers di test
    db.add(models.Answer(language_id="ENG", question_id="Q_NULL", response_text=None, status="pending"))
    db.add(models.Answer(language_id="ENG", question_id="Q_YES", response_text="yes", status="approved"))
    db.add(models.Answer(language_id="ENG", question_id="Q_NO", response_text="no", status="approved"))
    db.add(models.Answer(language_id="ENG", question_id="Q_UNSURE", response_text="unsure", status="approved"))
    # Q_NO_ROW: nessuna row, intenzionalmente

    db.commit()


def test_q11_includes_question_with_no_row_in_answers(db_fk):
    _seed_base(db_fk)
    res = query_11_unanswered("ENG", db=db_fk)
    qids = {a["q_id"] for a in res["answers"]}
    assert "Q_NO_ROW" in qids


def test_q11_includes_question_with_null_response(db_fk):
    _seed_base(db_fk)
    res = query_11_unanswered("ENG", db=db_fk)
    qids = {a["q_id"] for a in res["answers"]}
    assert "Q_NULL" in qids


def test_q11_excludes_yes_no_unsure_answers(db_fk):
    _seed_base(db_fk)
    res = query_11_unanswered("ENG", db=db_fk)
    qids = {a["q_id"] for a in res["answers"]}
    assert "Q_YES" not in qids
    assert "Q_NO" not in qids
    assert "Q_UNSURE" not in qids, "unsure e' una risposta data, non deve apparire"


def test_q11_excludes_inactive_questions(db_fk):
    _seed_base(db_fk)
    res = query_11_unanswered("ENG", db=db_fk)
    qids = {a["q_id"] for a in res["answers"]}
    assert "Q_INACTIVE" not in qids


def test_q11_excludes_questions_of_inactive_parameters(db_fk):
    _seed_base(db_fk)
    res = query_11_unanswered("ENG", db=db_fk)
    qids = {a["q_id"] for a in res["answers"]}
    assert "Q_ORPHAN" not in qids, \
        "Una question attiva su un parametro disattivato non deve comparire."


def test_q11_returns_only_no_row_and_null(db_fk):
    """Sanity check finale: esattamente Q_NO_ROW e Q_NULL devono apparire,
    nessuna altra."""
    _seed_base(db_fk)
    res = query_11_unanswered("ENG", db=db_fk)
    qids = sorted(a["q_id"] for a in res["answers"])
    assert qids == ["Q_NO_ROW", "Q_NULL"]


def test_q11_response_shape_matches_q89(db_fk):
    """Stesso payload di Q8/Q9 (language + answers[{q_id,text,p_id}])."""
    _seed_base(db_fk)
    res = query_11_unanswered("ENG", db=db_fk)
    assert res["language"]["id"] == "ENG"
    assert res["language"]["name"] == "English"
    for a in res["answers"]:
        assert set(a.keys()) == {"q_id", "text", "p_id"}


def test_q11_sorted_by_parameter_id(db_fk):
    _seed_base(db_fk)
    res = query_11_unanswered("ENG", db=db_fk)
    p_ids = [a["p_id"] for a in res["answers"]]
    assert p_ids == sorted(p_ids)


def test_q11_unknown_language_returns_404(db_fk):
    _seed_base(db_fk)
    with pytest.raises(HTTPException) as exc:
        query_11_unanswered("NOPE", db=db_fk)
    assert exc.value.status_code == 404


def test_q11_empty_when_every_question_answered(db_fk):
    """Se ogni question attiva ha una risposta valida, la lista e' vuota."""
    db_fk.add(models.Language(id="ITA", name_full="Italiano", position=1))
    db_fk.add(models.ParameterDef(id="P1", position=1, name="P", is_active=True))
    db_fk.add(models.Question(id="Q1", parameter_id="P1", text="?", is_active=True))
    db_fk.add(models.Question(id="Q2", parameter_id="P1", text="?", is_active=True))
    db_fk.add(models.Answer(language_id="ITA", question_id="Q1", response_text="yes"))
    db_fk.add(models.Answer(language_id="ITA", question_id="Q2", response_text="no"))
    db_fk.commit()

    res = query_11_unanswered("ITA", db=db_fk)
    assert res["answers"] == []
