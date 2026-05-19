"""Test di `services.migration_import._import_compilation_xlsx`.

Lo scope qui e' coprire il parser della colonna `Language_Answer` con i nuovi
valori UNSURE/U/? (regression del fix di export). Non e' un test del flusso
completo del migration import (che e' un one-shot all'avvio del progetto):
testiamo il subset critico col minimo seed possibile.
"""
import io
import pytest
from openpyxl import Workbook

import models
from services.excel_export import DATABASE_MODEL_HEADERS
from services.migration_import import _import_compilation_xlsx, MigrationReport


def _seed_minimal(db):
    db.add(models.Language(id="ITA", name_full="Italiano", position=1))
    db.add(models.ParameterDef(id="FGM", position=1, name="P", is_active=True))
    db.add(models.Question(id="FGM_01", parameter_id="FGM", text="?", is_active=True))
    db.add(models.Question(id="FGM_02", parameter_id="FGM", text="?", is_active=True))
    db.add(models.Question(id="FGM_03", parameter_id="FGM", text="?", is_active=True))
    db.add(models.Question(id="FGM_04", parameter_id="FGM", text="?", is_active=True))
    db.commit()


def _ws_from_rows(rows):
    """Costruisce un Worksheet 'Database_model' in memoria con DATABASE_MODEL_HEADERS."""
    wb = Workbook()
    wb.remove(wb.active)
    ws = wb.create_sheet("Database_model")
    ws.append(DATABASE_MODEL_HEADERS)
    for r in rows:
        ws.append(r)
    return ws


def test_migration_import_yes_no_still_work(db_session):
    """Sanity: la logica esistente per YES/NO non e' stata rotta dal fix UNSURE."""
    _seed_minimal(db_session)
    ws = _ws_from_rows([
        ["Italiano", "FGM", "FGM_01", "YES", "", "", "", "", "", "", ""],
        ["Italiano", "FGM", "FGM_02", "NO", "", "", "", "", "", "", ""],
    ])

    report = MigrationReport()
    _import_compilation_xlsx(db_session, ws, "italian.xlsx", report)
    db_session.commit()

    assert report.errors == [], f"Errori inattesi: {report.errors}"
    by_qid = {
        a.question_id: a
        for a in db_session.query(models.Answer).filter_by(language_id="ITA").all()
    }
    assert by_qid["FGM_01"].response_text == "yes"
    assert by_qid["FGM_02"].response_text == "no"


def test_migration_import_unsure_uppercase(db_session):
    """'UNSURE' (canonico, prodotto dall'export attuale) -> response_text='unsure'."""
    _seed_minimal(db_session)
    ws = _ws_from_rows([
        ["Italiano", "FGM", "FGM_01", "UNSURE", "uncertain", "", "", "", "", "", ""],
    ])

    report = MigrationReport()
    _import_compilation_xlsx(db_session, ws, "italian.xlsx", report)
    db_session.commit()

    assert report.errors == [], f"UNSURE deve essere accettato: {report.errors}"
    a = db_session.query(models.Answer).filter_by(
        language_id="ITA", question_id="FGM_01",
    ).one()
    assert a.response_text == "unsure"
    assert a.comments == "uncertain"


def test_migration_import_unsure_short_forms(db_session):
    """Varianti corte 'U' e '?' (utile per compilazione manuale)."""
    _seed_minimal(db_session)
    ws = _ws_from_rows([
        ["Italiano", "FGM", "FGM_01", "U", "", "", "", "", "", "", ""],
        ["Italiano", "FGM", "FGM_02", "?", "", "", "", "", "", "", ""],
    ])

    report = MigrationReport()
    _import_compilation_xlsx(db_session, ws, "italian.xlsx", report)
    db_session.commit()

    assert report.errors == [], f"U/? devono essere accettati: {report.errors}"
    by_qid = {
        a.question_id: a
        for a in db_session.query(models.Answer).filter_by(language_id="ITA").all()
    }
    assert by_qid["FGM_01"].response_text == "unsure"
    assert by_qid["FGM_02"].response_text == "unsure"


def test_migration_import_mixed_responses_no_regression(db_session):
    """YES + NO + UNSURE + vuoto in uno stesso foglio: tutto deve essere
    importato correttamente, senza errori."""
    _seed_minimal(db_session)
    ws = _ws_from_rows([
        ["Italiano", "FGM", "FGM_01", "YES", "", "", "", "", "", "", ""],
        ["Italiano", "FGM", "FGM_02", "NO", "", "", "", "", "", "", ""],
        ["Italiano", "FGM", "FGM_03", "UNSURE", "", "", "", "", "", "", ""],
        ["Italiano", "FGM", "FGM_04", "", "", "", "", "", "", "", ""],
    ])

    report = MigrationReport()
    _import_compilation_xlsx(db_session, ws, "italian.xlsx", report)
    db_session.commit()

    assert report.errors == [], f"Nessun errore atteso: {report.errors}"
    by_qid = {
        a.question_id: a
        for a in db_session.query(models.Answer).filter_by(language_id="ITA").all()
    }
    assert by_qid["FGM_01"].response_text == "yes"
    assert by_qid["FGM_02"].response_text == "no"
    assert by_qid["FGM_03"].response_text == "unsure"
    # FGM_04 vuoto -> nessuna answer inserita
    assert "FGM_04" not in by_qid


def test_migration_import_invalid_value_still_reports_error_with_unsure_in_message(db_session):
    """Un valore non riconosciuto deve essere segnalato, e il messaggio deve
    elencare anche UNSURE tra i valori validi (cosi' chi legge il report sa
    che 'unsure' e' un'opzione legittima)."""
    _seed_minimal(db_session)
    ws = _ws_from_rows([
        ["Italiano", "FGM", "FGM_01", "MAYBE", "", "", "", "", "", "", ""],
    ])

    report = MigrationReport()
    _import_compilation_xlsx(db_session, ws, "italian.xlsx", report)
    db_session.commit()

    err = next((e for e in report.errors if (e.value or "").upper() == "MAYBE"), None)
    assert err is not None, "Un valore invalido deve essere riportato"
    assert "UNSURE" in (err.reason or "")
