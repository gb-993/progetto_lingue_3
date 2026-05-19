"""Test end-to-end della cancellazione "vera" di una Language.

Verifica:
  - DELETE rimuove la lingua e a cascata answers/examples/answer_motivations,
    language_parameters/evals/statuses, submissions e relative children,
    language_aliases.
  - Le motivations (dizionario globale) NON vengono toccate.
  - Le archived_answers (snapshot storici di question rimosse) NON vengono toccate
    anche se contengono il language_id della lingua cancellata.
  - Una entry operation="delete" viene aggiunta in entity_versions.

Tutto orchestrato su SQLite in-memory con PRAGMA foreign_keys=ON, cosi'
l'ON DELETE CASCADE che abbiamo dichiarato a livello DB si attiva.
"""
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
    """Lingua + risposte + esempi + motivazioni + parametri/eval/statuses
    + alias + submission con tutte le children."""
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
    """La cancellazione della lingua deve azzerare tutte le tabelle figlie/nipote."""
    user = _admin(db_fk)
    _seed_populated_language(db_fk, "ENG")

    delete_admin_language("ENG", db=db_fk, current_user=user)

    # Lingua sparita
    assert db_fk.query(models.Language).filter_by(id="ENG").first() is None
    # Risposte + esempi + motivation-link
    assert db_fk.query(models.Answer).filter_by(language_id="ENG").count() == 0
    assert db_fk.query(models.Example).count() == 0
    assert db_fk.query(models.AnswerMotivation).count() == 0
    # Parametri + eval + status
    assert db_fk.query(models.LanguageParameter).filter_by(language_id="ENG").count() == 0
    assert db_fk.query(models.LanguageParameterEval).count() == 0
    assert db_fk.query(models.LanguageParameterStatus).filter_by(language_id="ENG").count() == 0
    # Alias
    assert db_fk.query(models.LanguageAlias).filter_by(language_id="ENG").count() == 0
    # Submissions e children
    assert db_fk.query(models.Submission).filter_by(language_id="ENG").count() == 0
    assert db_fk.query(models.SubmissionAnswer).count() == 0
    assert db_fk.query(models.SubmissionExample).count() == 0
    assert db_fk.query(models.SubmissionAnswerMotivation).count() == 0
    assert db_fk.query(models.SubmissionParam).count() == 0


def test_delete_does_not_touch_motivations_dictionary(db_fk):
    """Il dizionario globale delle Motivations resta intatto."""
    user = _admin(db_fk)
    _seed_populated_language(db_fk, "ENG")
    assert db_fk.query(models.Motivation).filter_by(code="MOT_X").count() == 1

    delete_admin_language("ENG", db=db_fk, current_user=user)

    # Motivation row ancora presente (e' un dizionario condiviso)
    assert db_fk.query(models.Motivation).filter_by(code="MOT_X").count() == 1


def test_delete_does_not_touch_question_allowed_motivations(db_fk):
    """Il join QuestionAllowedMotivation non e' figlio della lingua: non va toccato."""
    user = _admin(db_fk)
    _seed_populated_language(db_fk, "ENG")
    assert db_fk.query(models.QuestionAllowedMotivation).count() == 1

    delete_admin_language("ENG", db=db_fk, current_user=user)

    assert db_fk.query(models.QuestionAllowedMotivation).count() == 1


def test_delete_does_not_touch_archived_answers(db_fk):
    """archived_answers ha language_id denormalizzato senza FK: resta storico."""
    user = _admin(db_fk)
    _seed_populated_language(db_fk, "ENG")
    # Crea un archived_question + archived_answer che cita "ENG"
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

    # archived_answers conserva il language_id "ENG" anche dopo la cancellazione
    aas = db_fk.query(models.ArchivedAnswer).filter_by(language_id="ENG").all()
    assert len(aas) == 1


def test_delete_creates_history_entry(db_fk):
    """Una entry operation=delete deve essere registrata in entity_versions."""
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
    """Lingua senza nessun dato operativo: il DELETE deve funzionare comunque."""
    user = _admin(db_fk)
    db_fk.add(models.Language(id="EMPTY", name_full="E", position=1))
    db_fk.commit()
    delete_admin_language("EMPTY", db=db_fk, current_user=user)
    assert db_fk.query(models.Language).filter_by(id="EMPTY").first() is None
