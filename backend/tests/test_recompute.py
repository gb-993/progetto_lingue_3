"""Ricalcolo completo di una lingua: dopo restore e import i valori vanno rifatti dalle risposte."""
import io

from fastapi import BackgroundTasks
from sqlalchemy.orm import sessionmaker

import models
from services import recompute as recompute_mod
from services.backup_restore import restore_backup_bundle
from services.dag_eval import run_dag_for_language
from services.excel_export import build_backup_zip_bytes, build_language_workbook, build_schema_workbook
from services.excel_import import import_excel
from services.recompute import recompute_after_excel_import, recompute_all_languages, recompute_language
from tests.test_backup_restore import _seed_full


def _values(db, lang_id="ITA"):
    """parametro -> (valore grezzo, valore finale)."""
    rows = (
        db.query(models.LanguageParameter.parameter_id, models.LanguageParameter.value_orig,
                 models.LanguageParameterEval.value_eval)
        .join(models.LanguageParameterEval,
              models.LanguageParameterEval.language_parameter_id == models.LanguageParameter.id)
        .filter(models.LanguageParameter.language_id == lang_id)
        .all()
    )
    return {pid: (orig, final) for pid, orig, final in rows}


def _add_language(db, lang_id, response):
    db.add(models.Language(id=lang_id, name_full=lang_id, position=2))
    db.add(models.Answer(language_id=lang_id, question_id="FGM_01", response_text=response, status="approved"))
    db.add(models.Answer(language_id=lang_id, question_id="FGM_02", response_text="no", status="approved"))
    db.commit()


def _import(db, wb, user, background_tasks):
    """Come l'endpoint di import: importa il file, poi fa ricalcolare i valori."""
    buf = io.BytesIO()
    wb.save(buf)
    report = import_excel(db, buf.getvalue(), user.id)
    return recompute_after_excel_import(db, report, background_tasks)


def test_second_step_alone_cannot_rebuild_the_values(db_session):
    # il caso del bug: senza valori grezzi il solo passo 2 dà '?'
    _seed_full(db_session)
    run_dag_for_language("ITA", db_session)
    assert _values(db_session) == {"FGM": (None, "?")}


def test_recompute_language_starts_from_the_answers(db_session):
    _seed_full(db_session)
    report = recompute_language(db_session, "ITA")
    assert _values(db_session) == {"FGM": ("+", "+")}
    assert report.processed == ["FGM"]


def test_recompute_language_replaces_stale_values(db_session):
    _seed_full(db_session)
    lp = models.LanguageParameter(language_id="ITA", parameter_id="FGM", value_orig="-", warning_orig=False)
    db_session.add(lp)
    db_session.flush()
    db_session.add(models.LanguageParameterEval(language_parameter_id=lp.id, value_eval="-", warning_eval=False))
    db_session.commit()

    recompute_language(db_session, "ITA")
    assert _values(db_session) == {"FGM": ("+", "+")}


def test_restore_with_wipe_rebuilds_the_values(db_session):
    user = _seed_full(db_session)
    zip_bytes = build_backup_zip_bytes(db_session, db_session.query(models.Language).all())

    restore_backup_bundle(db_session, zip_bytes, user.id, wipe=True)
    db_session.commit()

    assert _values(db_session) == {"FGM": ("+", "+")}


def test_restore_recomputes_also_languages_outside_the_bundle(db_session):
    user = _seed_full(db_session)
    _add_language(db_session, "FRA", "no")
    italian = db_session.query(models.Language).filter_by(id="ITA").all()
    zip_bytes = build_backup_zip_bytes(db_session, italian)

    restore_backup_bundle(db_session, zip_bytes, user.id, wipe=False)
    db_session.commit()

    assert _values(db_session, "ITA") == {"FGM": ("+", "+")}
    assert _values(db_session, "FRA") == {"FGM": ("-", "-")}


def test_recompute_all_languages(db_session, monkeypatch):
    _seed_full(db_session)
    _add_language(db_session, "FRA", "no")
    monkeypatch.setattr(recompute_mod, "SessionLocal", sessionmaker(bind=db_session.get_bind()))

    seen = []
    errors = recompute_all_languages(on_language=lambda position, total, lang_id: seen.append((position, total, lang_id)))

    assert errors == []
    assert seen == [(1, 2, "FRA"), (2, 2, "ITA")]
    db_session.expire_all()
    assert _values(db_session, "ITA") == {"FGM": ("+", "+")}
    assert _values(db_session, "FRA") == {"FGM": ("-", "-")}


def test_excel_import_of_a_language_recomputes_its_values(db_session):
    user = _seed_full(db_session)
    lang = db_session.query(models.Language).filter_by(id="ITA").one()
    background_tasks = BackgroundTasks()

    outcome = _import(db_session, build_language_workbook(db_session, lang, is_admin=True), user, background_tasks)

    assert outcome == "language_done"
    assert background_tasks.tasks == []
    assert _values(db_session) == {"FGM": ("+", "+")}


def test_excel_import_of_the_schema_recomputes_all_languages(db_session):
    user = _seed_full(db_session)
    background_tasks = BackgroundTasks()

    outcome = _import(db_session, build_schema_workbook(db_session), user, background_tasks)

    assert outcome == "all_languages_started"
    assert [task.func for task in background_tasks.tasks] == [recompute_all_languages]
