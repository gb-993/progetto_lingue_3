"""Fingerprint del blocco: conta solo le question attive (se no 409 a ogni save)."""
from datetime import datetime

import models
from routers.compilation import _block_last_modified_iso


def test_fingerprint_ignores_inactive_question_answer(db_session):
    db_session.add(models.Language(id="ITA", name_full="Italiano", position=1))
    db_session.add(models.ParameterDef(id="P1", position=1, name="P1", is_active=True))
    db_session.add(models.Question(id="P1_01", parameter_id="P1", text="q1", is_active=True))
    db_session.add(models.Question(id="P1_02", parameter_id="P1", text="q2", is_active=False))
    db_session.commit()

    # attiva: aggiornata prima
    active_ans = models.Answer(
        language_id="ITA", question_id="P1_01", response_text="no",
        updated_at=datetime(2026, 1, 1, 10, 0, 0),
    )
    # disattivata: aggiornata dopo, è il MAX globale
    inactive_ans = models.Answer(
        language_id="ITA", question_id="P1_02", response_text="yes",
        updated_at=datetime(2026, 1, 2, 10, 0, 0),
    )
    db_session.add_all([active_ans, inactive_ans])
    db_session.commit()

    fp = _block_last_modified_iso(db_session, "ITA", "P1")

    assert fp == active_ans.updated_at.isoformat()
    assert fp != inactive_ans.updated_at.isoformat()


def test_fingerprint_is_max_over_active_questions(db_session):
    db_session.add(models.Language(id="ITA", name_full="Italiano", position=1))
    db_session.add(models.ParameterDef(id="P1", position=1, name="P1", is_active=True))
    db_session.add(models.Question(id="P1_01", parameter_id="P1", text="q1", is_active=True))
    db_session.add(models.Question(id="P1_02", parameter_id="P1", text="q2", is_active=True))
    db_session.commit()

    a1 = models.Answer(language_id="ITA", question_id="P1_01", response_text="no",
                       updated_at=datetime(2026, 1, 1, 10, 0, 0))
    a2 = models.Answer(language_id="ITA", question_id="P1_02", response_text="no",
                       updated_at=datetime(2026, 1, 3, 10, 0, 0))
    db_session.add_all([a1, a2])
    db_session.commit()

    fp = _block_last_modified_iso(db_session, "ITA", "P1")
    assert fp == a2.updated_at.isoformat()


def test_fingerprint_none_when_only_inactive_has_answer(db_session):
    db_session.add(models.Language(id="ITA", name_full="Italiano", position=1))
    db_session.add(models.ParameterDef(id="P1", position=1, name="P1", is_active=True))
    db_session.add(models.Question(id="P1_01", parameter_id="P1", text="q1", is_active=True))
    db_session.add(models.Question(id="P1_02", parameter_id="P1", text="q2", is_active=False))
    db_session.commit()

    db_session.add(models.Answer(
        language_id="ITA", question_id="P1_02", response_text="yes",
        updated_at=datetime(2026, 1, 2, 10, 0, 0),
    ))
    db_session.commit()

    assert _block_last_modified_iso(db_session, "ITA", "P1") is None
