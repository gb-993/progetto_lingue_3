"""Cancellazione lingua: FK attive su SQLite per far scattare le cascade."""
import pytest
from fastapi import HTTPException
from sqlalchemy import text

import models
from routers.languages import delete_admin_language


@pytest.fixture
def db_fk(db_session):
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


def _seed_populated_language(db, lid: str = "ENG"):
    """Lingua con tutti i dati collegati."""
    lang = models.Language(id=lid, name_full=f"Lang {lid}", position=1)
    db.add(lang)

    param = models.ParameterDef(id="P1", position=1, name="P", is_active=True)
    q = models.Question(id="Q1", parameter_id="P1", text="?")
    mot = models.Motivation(code="MOT_X", label="Not applicable")
    db.add_all([param, q, mot])
    db.flush()

    db.add(models.QuestionAllowedMotivation(question_id="Q1", motivation_id=mot.id))

    ans = models.Answer(language_id=lid, question_id="Q1", response_text="yes")
    db.add(ans)
    db.flush()
    db.add(models.Example(answer_id=ans.id, number="1", textarea="ex"))
    db.add(models.AnswerMotivation(answer_id=ans.id, motivation_id=mot.id))

    lp = models.LanguageParameter(language_id=lid, parameter_id="P1", value_orig="+")
    db.add(lp)
    db.flush()
    db.add(models.LanguageParameterEval(language_parameter_id=lp.id, value_eval="+"))
    db.add(models.LanguageParameterStatus(language_id=lid, parameter_id="P1", admin_note="note"))

    db.add(models.LanguageAlias(language_id=lid, old_id="OldEng"))

    sub = models.Submission(language_id=lid, note="snap")
    db.add(sub)
    db.flush()
    db.add(models.SubmissionAnswer(submission_id=sub.id, question_code="Q1", response_text="yes"))
    db.add(models.SubmissionExample(submission_id=sub.id, question_code="Q1", textarea="ex"))
    db.add(models.SubmissionAnswerMotivation(
        submission_id=sub.id, question_code="Q1",
        motivation_code="MOT_X", motivation_label="Not applicable",
    ))
    db.add(models.SubmissionParam(submission_id=sub.id, parameter_id="P1", value_orig="+"))

    db.commit()
    return lang, param, q, mot


def test_delete_cascades_everything_operative(db_fk):
    """Spariscono tutti i dati collegati alla lingua."""
    user = _admin(db_fk)
    _seed_populated_language(db_fk, "ENG")

    delete_admin_language("ENG", db=db_fk, current_user=user)

    assert db_fk.query(models.Language).filter_by(id="ENG").first() is None
    assert db_fk.query(models.Answer).filter_by(language_id="ENG").count() == 0
    assert db_fk.query(models.Example).count() == 0
    assert db_fk.query(models.AnswerMotivation).count() == 0
    assert db_fk.query(models.LanguageParameter).filter_by(language_id="ENG").count() == 0
    assert db_fk.query(models.LanguageParameterEval).count() == 0
    assert db_fk.query(models.LanguageParameterStatus).filter_by(language_id="ENG").count() == 0
    assert db_fk.query(models.LanguageAlias).filter_by(language_id="ENG").count() == 0
    assert db_fk.query(models.Submission).filter_by(language_id="ENG").count() == 0
    assert db_fk.query(models.SubmissionAnswer).count() == 0
    assert db_fk.query(models.SubmissionExample).count() == 0
    assert db_fk.query(models.SubmissionAnswerMotivation).count() == 0
    assert db_fk.query(models.SubmissionParam).count() == 0


def test_delete_does_not_touch_motivations_dictionary(db_fk):
    user = _admin(db_fk)
    _seed_populated_language(db_fk, "ENG")
    assert db_fk.query(models.Motivation).filter_by(code="MOT_X").count() == 1

    delete_admin_language("ENG", db=db_fk, current_user=user)

    assert db_fk.query(models.Motivation).filter_by(code="MOT_X").count() == 1


def test_delete_does_not_touch_question_allowed_motivations(db_fk):
    """QuestionAllowedMotivation non dipende dalla lingua."""
    user = _admin(db_fk)
    _seed_populated_language(db_fk, "ENG")
    assert db_fk.query(models.QuestionAllowedMotivation).count() == 1

    delete_admin_language("ENG", db=db_fk, current_user=user)

    assert db_fk.query(models.QuestionAllowedMotivation).count() == 1


def test_delete_does_not_touch_archived_answers(db_fk):
    """archived_answers non ha FK sulla lingua: resta come storico."""
    user = _admin(db_fk)
    _seed_populated_language(db_fk, "ENG")
    aq = models.ArchivedQuestion(
        original_question_id="QOLD", parameter_id="P1",
        text="old text", archive_note="bumped",
    )
    db_fk.add(aq)
    db_fk.flush()
    db_fk.add(models.ArchivedAnswer(
        archived_question_id=aq.id, language_id="ENG",
        language_name_full="Lang ENG", response_text="yes",
    ))
    db_fk.commit()

    delete_admin_language("ENG", db=db_fk, current_user=user)

    aas = db_fk.query(models.ArchivedAnswer).filter_by(language_id="ENG").all()
    assert len(aas) == 1


def test_delete_creates_history_entry(db_fk):
    user = _admin(db_fk)
    _seed_populated_language(db_fk, "ENG")

    delete_admin_language("ENG", db=db_fk, current_user=user)

    versions = (
        db_fk.query(models.EntityVersion)
        .filter_by(entity_type="language", entity_id="ENG", operation="delete")
        .all()
    )
    assert len(versions) == 1
    snap = versions[0].snapshot
    assert snap.get("id") == "ENG"
    assert snap.get("name_full") == "Lang ENG"


def test_delete_404_on_missing(db_fk):
    user = _admin(db_fk)
    with pytest.raises(HTTPException) as exc:
        delete_admin_language("NOPE", db=db_fk, current_user=user)
    assert exc.value.status_code == 404


def test_delete_empty_language_still_works(db_fk):
    user = _admin(db_fk)
    db_fk.add(models.Language(id="EMPTY", name_full="E", position=1))
    db_fk.commit()
    delete_admin_language("EMPTY", db=db_fk, current_user=user)
    assert db_fk.query(models.Language).filter_by(id="EMPTY").first() is None
