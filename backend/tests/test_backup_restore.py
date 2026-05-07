"""
Test end-to-end del flusso backup → wipe → restore.

Verifica che il bundle ZIP prodotto da build_backup_zip_bytes sia restorable
tramite restore_backup_bundle: le lingue, parametri, domande, motivazioni,
glossario e i dati di compilazione devono tornare uguali dopo un wipe + restore.
"""
import pytest

import models
from services.excel_export import build_backup_zip_bytes
from services.backup_restore import restore_backup_bundle


def _seed_full(db_session):
    user = models.User(
        id=1, email="alice@test.it", hashed_password="x",
        name="Alice", surname="Smith", role="admin",
    )
    db_session.add(user)

    lang = models.Language(
        id="ITA", name_full="Italiano", position=1,
        family="Romance", top_level_family="Indo-European", grp="Italo-Western",
        latitude=42.5, longitude=12.0, historical_language=False,
        isocode="it", glottocode="ital1282",
        informant="Mario Rossi", supervisor="Cristina Guardiano",
        source="Various sources", location="Italia",
        status="approved",
    )
    db_session.add(lang)

    param = models.ParameterDef(
        id="FGM", position=1, name="Feature Geometry Marker",
        short_description="Test", long_description="",
        is_active=True,
    )
    db_session.add(param)

    q1 = models.Question(id="FGM_01", parameter_id="FGM", text="Q1?",
                         is_stop_question=False, is_active=True)
    q2 = models.Question(id="FGM_02", parameter_id="FGM", text="Q2?",
                         is_stop_question=False, is_active=True)
    db_session.add_all([q1, q2])

    mot = models.Motivation(code="MOT_X", label="Not applicable")
    db_session.add(mot)
    db_session.flush()

    db_session.add(models.QuestionAllowedMotivation(question_id="FGM_02", motivation_id=mot.id))

    ans1 = models.Answer(language_id="ITA", question_id="FGM_01",
                         response_text="yes", comments="ok", status="approved")
    ans2 = models.Answer(language_id="ITA", question_id="FGM_02",
                         response_text="no", comments="", status="approved")
    db_session.add_all([ans1, ans2])
    db_session.flush()

    db_session.add(models.AnswerMotivation(answer_id=ans2.id, motivation_id=mot.id))
    db_session.add(models.Example(
        answer_id=ans1.id, number="1", textarea="Esempio",
        gloss="g", translation="t", reference="r",
    ))
    db_session.add(models.LanguageParameterStatus(
        language_id="ITA", parameter_id="FGM",
        admin_note="Nota admin",
        is_unsure=False,
    ))
    db_session.add(models.Glossary(word="alpha", description="first letter"))
    db_session.commit()
    return user


def test_backup_restore_roundtrip(db_session):
    """Backup completo → wipe → restore: lo stato del DB dev'essere ripristinato."""
    user = _seed_full(db_session)

    # 1. Genera bundle
    languages = db_session.query(models.Language).all()
    zip_bytes = build_backup_zip_bytes(db_session, languages)

    # 2. Restore con wipe=True su una sessione "sporca": ripulisce e re-importa
    report = restore_backup_bundle(db_session, zip_bytes, user.id, wipe=True)
    db_session.commit()

    # Nessun errore atteso (o al massimo errori non bloccanti per le motivazioni
    # — ma in questo seed minimale tutto dovrebbe filare liscio)
    blocking = [e for e in report.errors if "Motivation" not in e.get("reason", "")]
    assert blocking == [], f"Errori bloccanti: {blocking}"

    # 3. Verifica DB ripristinato
    # Lingue
    lang = db_session.query(models.Language).filter_by(id="ITA").one()
    assert lang.name_full == "Italiano"
    assert lang.family == "Romance"
    assert lang.isocode == "it"
    assert float(lang.latitude) == 42.5

    # Schema (parametri / domande / motivazioni)
    p = db_session.query(models.ParameterDef).filter_by(id="FGM").one()
    assert p.name == "Feature Geometry Marker"
    assert db_session.query(models.Question).filter_by(parameter_id="FGM").count() == 2
    assert db_session.query(models.Motivation).filter_by(code="MOT_X").count() == 1

    # Risposte + esempi + motivazioni: ripristinate dal Database_model
    answers = db_session.query(models.Answer).filter_by(language_id="ITA").all()
    by_qid = {a.question_id: a for a in answers}
    assert by_qid["FGM_01"].response_text == "yes"
    assert by_qid["FGM_02"].response_text == "no"
    assert len(by_qid["FGM_01"].examples) == 1
    # Motivation MOT_X ripristinata sull'answer FGM_02
    mot_codes = [
        db_session.get(models.Motivation, am.motivation_id).code
        for am in by_qid["FGM_02"].answer_motivations
    ]
    assert "MOT_X" in mot_codes

    # Admin note ripristinata
    s = db_session.query(models.LanguageParameterStatus).filter_by(
        language_id="ITA", parameter_id="FGM"
    ).one()
    assert s.admin_note == "Nota admin"

    # Glossario ripristinato
    g = db_session.query(models.Glossary).filter_by(word="alpha").one()
    assert g.description == "first letter"

    # Files processati
    assert "schema.xlsx" in report.files_processed
    assert "languages_metadata.xlsx" in report.files_processed
    assert "glossary.xlsx" in report.files_processed
    assert "languages/ITA.xlsx" in report.files_processed
    assert "ITA" in report.languages_restored


def test_backup_restore_bad_zip(db_session):
    """Bundle non valido → errore esplicito, no crash."""
    user = _seed_full(db_session)

    report = restore_backup_bundle(db_session, b"not a zip", user.id, wipe=False)
    assert any("ZIP" in e["reason"] for e in report.errors)
    assert report.files_processed == []
