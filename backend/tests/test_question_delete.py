"""Test dell'eliminazione DEFINITIVA di una Question (services/question_delete).

Copre: archivia-poi-elimina dei dati collegati, snapshot 'delete' in History,
log sul parametro, cascata di alias/allowed-motivations, guard sulla question
ancora attiva.
"""
import pytest

import models
from services.question_delete import (
    delete_question_permanently,
    QuestionStillActiveError,
)


def _seed_param(db):
    db.add(models.Language(id="ITA", name_full="Italiano", position=1))
    db.add(models.ParameterDef(id="P1", position=1, name="P1", is_active=True))
    db.commit()


def _q(db, qid="P1_01"):
    return db.query(models.Question).filter(models.Question.id == qid).first()


def test_delete_inactive_question_without_data(db_session):
    _seed_param(db_session)
    db_session.add(models.Question(id="P1_01", parameter_id="P1", text="q1", is_active=False))
    db_session.commit()

    archived_id = delete_question_permanently(db_session, _q(db_session), user_id=1)
    db_session.commit()

    # Question rimossa, nessun archivio (non c'erano dati).
    assert _q(db_session) is None
    assert archived_id is None
    assert db_session.query(models.ArchivedQuestion).count() == 0
    # Snapshot 'delete' in History.
    ver = db_session.query(models.EntityVersion).filter_by(
        entity_type="question", entity_id="P1_01").one()
    assert ver.operation == "delete"
    # Log sul parametro.
    log = db_session.query(models.ParameterChangeLog).filter_by(parameter_id="P1").one()
    assert "Permanently deleted" in log.change_note


def test_delete_inactive_question_archives_linked_data(db_session):
    _seed_param(db_session)
    mot = models.Motivation(code="M1", label="Mot 1")
    db_session.add(mot)
    db_session.add(models.Question(id="P1_01", parameter_id="P1", text="q1", is_active=False))
    db_session.commit()

    # Config: allowed motivation + alias storico -> devono sparire per cascata.
    db_session.add(models.QuestionAllowedMotivation(question_id="P1_01", motivation_id=mot.id))
    db_session.add(models.QuestionAlias(question_id="P1_01", old_id="OLD_01"))
    # Dati linguistici: 1 risposta YES con 2 esempi + 1 motivazione -> da archiviare.
    ans = models.Answer(language_id="ITA", question_id="P1_01", response_text="yes")
    db_session.add(ans)
    db_session.flush()
    db_session.add(models.Example(answer_id=ans.id, textarea="es1"))
    db_session.add(models.Example(answer_id=ans.id, textarea="es2"))
    db_session.add(models.AnswerMotivation(answer_id=ans.id, motivation_id=mot.id))
    db_session.commit()

    archived_id = delete_question_permanently(db_session, _q(db_session), user_id=1)
    db_session.commit()

    # Question rimossa.
    assert _q(db_session) is None
    # Dati vivi spariti.
    assert db_session.query(models.Answer).filter_by(question_id="P1_01").count() == 0
    assert db_session.query(models.Example).count() == 0
    assert db_session.query(models.AnswerMotivation).count() == 0
    # Cascata: alias e allowed-motivations spariti.
    assert db_session.query(models.QuestionAlias).count() == 0
    assert db_session.query(models.QuestionAllowedMotivation).count() == 0

    # Archivio creato con i conteggi giusti.
    assert archived_id is not None
    aq = db_session.query(models.ArchivedQuestion).filter_by(id=archived_id).one()
    assert aq.original_question_id == "P1_01"
    assert aq.answers_count == 1
    assert aq.examples_count == 2
    assert db_session.query(models.ArchivedAnswer).filter_by(
        archived_question_id=archived_id).count() == 1
    assert db_session.query(models.ArchivedExample).count() == 2
    # Motivation (dizionario globale) NON toccata.
    assert db_session.query(models.Motivation).filter_by(id=mot.id).first() is not None
    # Log col conteggio archiviato.
    log = db_session.query(models.ParameterChangeLog).filter_by(parameter_id="P1").one()
    assert "archived" in log.change_note


def test_delete_active_question_is_rejected(db_session):
    _seed_param(db_session)
    db_session.add(models.Question(id="P1_01", parameter_id="P1", text="q1", is_active=True))
    db_session.commit()

    with pytest.raises(QuestionStillActiveError):
        delete_question_permanently(db_session, _q(db_session), user_id=1)

    # La question attiva resta intatta.
    assert _q(db_session) is not None
