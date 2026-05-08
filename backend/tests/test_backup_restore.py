"""
Test end-to-end del flusso backup → wipe → restore.

Verifica che il bundle ZIP prodotto da build_backup_zip_bytes sia restorable
tramite restore_backup_bundle: le lingue, parametri, domande, motivazioni,
glossario e i dati di compilazione devono tornare uguali dopo un wipe + restore.
"""
import pytest

import models
from services.excel_export import build_backup_zip_bytes, build_full_backup_zip_bytes
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


def _seed_extras(db_session, user):
    """Aggiunge dati per le tabelle extras: site_content, submission,
    parameter_submission, archived_question (con figli)."""
    db_session.add(models.SiteContent(
        key="how_to_cite_body",
        content="<p>Cite this work as...</p>",
        page="HowToCite",
        updated_by_id=user.id,
    ))

    sub = models.Submission(
        language_id="ITA",
        submitted_by_id=user.id,
        note="Initial submission",
    )
    db_session.add(sub)
    db_session.flush()
    db_session.add_all([
        models.SubmissionAnswer(submission_id=sub.id, question_code="FGM_01",
                                response_text="yes", comments="ok"),
        models.SubmissionExample(submission_id=sub.id, question_code="FGM_01",
                                 textarea="Esempio sub", gloss="g", translation="t"),
        models.SubmissionAnswerMotivation(submission_id=sub.id, question_code="FGM_02",
                                          motivation_code="MOT_X", motivation_label="Not applicable"),
        models.SubmissionParam(submission_id=sub.id, parameter_id="FGM",
                               value_orig="+", warning_orig=False,
                               value_eval="+", warning_eval=False),
    ])

    psub = models.ParameterSubmission(
        parameter_id="FGM", parameter_name="Feature Geometry Marker",
        submitted_by_id=user.id, note="Param snapshot",
        short_description="Test", long_description="",
        is_active=True, position=1, schema="", param_type="", level_of_comparison="",
    )
    db_session.add(psub)
    db_session.flush()
    psq = models.ParameterSubmissionQuestion(
        submission_id=psub.id, question_code="FGM_01",
        text="Q1?", is_stop_question=False, is_active=True,
    )
    db_session.add(psq)
    db_session.flush()
    db_session.add(models.ParameterSubmissionAllowedMotivation(
        question_id=psq.id, motivation_code="MOT_X", motivation_label="Not applicable",
    ))

    aq = models.ArchivedQuestion(
        original_question_id="OBS_01", parameter_id="OBS", parameter_name="Obsolete",
        text="Old question", is_stop_question=False, is_active=False,
        archived_by_id=user.id, archive_note="Reworded",
        answers_count=1, examples_count=1,
    )
    db_session.add(aq)
    db_session.flush()
    db_session.add(models.ArchivedQuestionMotivation(
        archived_question_id=aq.id, motivation_code="MOT_X", motivation_label="Not applicable",
    ))
    aa = models.ArchivedAnswer(
        archived_question_id=aq.id, language_id="ITA", language_name_full="Italiano",
        status="approved", response_text="yes", comments="legacy",
    )
    db_session.add(aa)
    db_session.flush()
    db_session.add(models.ArchivedExample(
        archived_answer_id=aa.id, number="1", textarea="Old example",
    ))
    db_session.add(models.ArchivedAnswerMotivation(
        archived_answer_id=aa.id, motivation_code="MOT_X", motivation_label="Not applicable",
    ))

    db_session.commit()


def test_full_backup_restore_roundtrip(db_session):
    """Bundle full → wipe → restore: anche le tabelle extras tornano identiche."""
    user = _seed_full(db_session)
    _seed_extras(db_session, user)

    languages = db_session.query(models.Language).all()
    zip_bytes = build_full_backup_zip_bytes(db_session, languages)

    # Verifica che il bundle contenga la cartella extras/
    import zipfile, io
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        names = zf.namelist()
    assert "extras/site_content.xlsx" in names
    assert "extras/submissions.xlsx" in names
    assert "extras/parameter_submissions.xlsx" in names
    assert "extras/archived_questions.xlsx" in names

    # Restore con wipe → estras vengono ripopolati
    report = restore_backup_bundle(db_session, zip_bytes, user.id, wipe=True)
    db_session.commit()

    blocking = [e for e in report.errors if "Motivation" not in e.get("reason", "")]
    assert blocking == [], f"Errori bloccanti: {blocking}"

    # SiteContent: upsert per key
    sc = db_session.query(models.SiteContent).filter_by(key="how_to_cite_body").one()
    assert sc.page == "HowToCite"
    assert "Cite this work" in sc.content

    # Submission + figlie
    subs = db_session.query(models.Submission).all()
    assert len(subs) == 1
    sub = subs[0]
    assert sub.language_id == "ITA"
    assert sub.note == "Initial submission"
    assert len(sub.answers) == 1
    assert sub.answers[0].response_text == "yes"
    assert len(sub.examples) == 1
    assert sub.examples[0].textarea == "Esempio sub"
    assert len(sub.answer_motivations) == 1
    assert sub.answer_motivations[0].motivation_code == "MOT_X"
    assert len(sub.params) == 1
    assert sub.params[0].value_orig == "+"

    # ParameterSubmission + figlie
    psubs = db_session.query(models.ParameterSubmission).all()
    assert len(psubs) == 1
    psub = psubs[0]
    assert psub.parameter_id == "FGM"
    assert psub.note == "Param snapshot"
    assert len(psub.questions) == 1
    psq = psub.questions[0]
    assert psq.question_code == "FGM_01"
    assert len(psq.allowed_motivations) == 1
    assert psq.allowed_motivations[0].motivation_code == "MOT_X"

    # ArchivedQuestion + figli/nipoti
    aqs = db_session.query(models.ArchivedQuestion).all()
    assert len(aqs) == 1
    aq = aqs[0]
    assert aq.original_question_id == "OBS_01"
    assert aq.archive_note == "Reworded"
    assert len(aq.allowed_motivations) == 1
    assert len(aq.answers) == 1
    aa = aq.answers[0]
    assert aa.language_id == "ITA"
    assert aa.response_text == "yes"
    assert len(aa.examples) == 1
    assert aa.examples[0].textarea == "Old example"
    assert len(aa.answer_motivations) == 1


def test_full_backup_restore_no_wipe_skips_snapshots(db_session):
    """Senza wipe: site_content viene comunque upsertato (chiave naturale),
    ma submissions/parameter_submissions/archived_questions sono saltati per
    evitare duplicati su PK auto-increment."""
    user = _seed_full(db_session)
    _seed_extras(db_session, user)

    languages = db_session.query(models.Language).all()
    zip_bytes = build_full_backup_zip_bytes(db_session, languages)

    # Conta quanti record ci sono PRIMA del restore
    n_subs_before = db_session.query(models.Submission).count()
    n_psubs_before = db_session.query(models.ParameterSubmission).count()
    n_aqs_before = db_session.query(models.ArchivedQuestion).count()

    report = restore_backup_bundle(db_session, zip_bytes, user.id, wipe=False)
    db_session.commit()

    # site_content: upsertato comunque
    assert "extras/site_content.xlsx" in report.files_processed
    sc = db_session.query(models.SiteContent).filter_by(key="how_to_cite_body").one()
    assert "Cite this work" in sc.content

    # snapshot tables: saltate
    assert "extras/submissions.xlsx" in report.files_skipped
    assert "extras/parameter_submissions.xlsx" in report.files_skipped
    assert "extras/archived_questions.xlsx" in report.files_skipped

    # E i conteggi non sono cambiati
    assert db_session.query(models.Submission).count() == n_subs_before
    assert db_session.query(models.ParameterSubmission).count() == n_psubs_before
    assert db_session.query(models.ArchivedQuestion).count() == n_aqs_before


def test_standard_backup_compat_with_extras_aware_restore(db_session):
    """Il bundle standard (senza extras/) resta restorable con la nuova
    versione del restore — retrocompatibilità."""
    user = _seed_full(db_session)

    languages = db_session.query(models.Language).all()
    zip_bytes = build_backup_zip_bytes(db_session, languages)

    report = restore_backup_bundle(db_session, zip_bytes, user.id, wipe=True)
    db_session.commit()

    # Nessun file extras/* dovrebbe apparire
    assert not any(p.startswith("extras/") for p in report.files_processed)
    assert "ITA" in report.languages_restored
