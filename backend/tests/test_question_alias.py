"""Test unit del resolver `resolve_question`.

Verifica:
  - match per id corrente (no alias)
  - match per alias storico
  - alias orfano (domanda puntata cancellata) -> miss
  - id assente -> miss
"""
import models
from services.question_alias import resolve_question


def _make_question(db, qid: str) -> models.Question:
    param = db.query(models.ParameterDef).filter_by(id="P1").first()
    if param is None:
        param = models.ParameterDef(id="P1", position=1, name="P", is_active=True)
        db.add(param)
        db.flush()
    q = models.Question(id=qid, parameter_id="P1", text="?")
    db.add(q)
    db.commit()
    return q


def test_resolve_by_current_id_no_alias(db_session):
    _make_question(db_session, "P1_Qa")
    res = resolve_question(db_session, "P1_Qa")
    assert res.question is not None
    assert res.question.id == "P1_Qa"
    assert res.matched_via_alias is False


def test_resolve_by_alias(db_session):
    q = _make_question(db_session, "P1_Qa")
    db_session.add(models.QuestionAlias(question_id=q.id, old_id="P1_OLD"))
    db_session.commit()

    res = resolve_question(db_session, "P1_OLD")
    assert res.question is not None
    assert res.question.id == "P1_Qa"
    assert res.matched_via_alias is True


def test_resolve_orphan_alias_returns_none(db_session):
    # db_session non ha FK enforcement attivo: creo un alias che punta a una
    # domanda inesistente per simulare l'orfano (domanda cancellata) -> miss.
    db_session.add(models.QuestionAlias(question_id="P1_GONE", old_id="P1_OLD"))
    db_session.commit()
    res = resolve_question(db_session, "P1_OLD")
    assert res.question is None


def test_resolve_unknown_id_returns_none(db_session):
    _make_question(db_session, "P1_Qa")
    res = resolve_question(db_session, "XX_UNKNOWN")
    assert res.question is None
    assert res.matched_via_alias is False


def test_resolve_empty_id_returns_none(db_session):
    res = resolve_question(db_session, "")
    assert res.question is None
