import io

import pytest
from fastapi import HTTPException
from openpyxl import Workbook
from sqlalchemy import text

import models
from routers.languages import update_admin_language, LanguageBase


@pytest.fixture
def db_fk(db_session):
    """Attiva le FK su SQLite (spente di default): servono per le cascade."""
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


def _seed_lang(db, lid: str = "ENG", glotto: str = "stan1293") -> models.Language:
    lang = models.Language(
        id=lid, name_full=f"Lang {lid}", position=1, glottocode=glotto,
    )
    db.add(lang)
    db.commit()
    return lang


def _put_item_from(lang: models.Language, new_id: str) -> LanguageBase:
    """Payload PUT uguale alla lingua, cambia solo l'id."""
    return LanguageBase(
        id=new_id,
        name_full=lang.name_full,
        position=lang.position,
        family=lang.family or "",
        top_level_family=lang.top_level_family or "",
        grp=lang.grp or "",
        latitude=float(lang.latitude) if lang.latitude is not None else None,
        longitude=float(lang.longitude) if lang.longitude is not None else None,
        historical_language=lang.historical_language or False,
        assigned_user_id=None,
        isocode=lang.isocode or "",
        glottocode=lang.glottocode or "",
        informant=lang.informant or "",
        supervisor=lang.supervisor or "",
        source=lang.source or "",
        location=lang.location or "",
    )


def test_rename_creates_alias(db_fk):
    user = _admin(db_fk)
    lang = _seed_lang(db_fk, "ENG")

    payload = _put_item_from(lang, "EngTest")
    out = update_admin_language("ENG", payload, db=db_fk, current_user=user)

    assert out.id == "EngTest"
    aliases = db_fk.query(models.LanguageAlias).filter_by(language_id="EngTest").all()
    assert len(aliases) == 1
    assert aliases[0].old_id == "ENG"


def test_rename_cascades_on_children(db_fk):
    user = _admin(db_fk)
    lang = _seed_lang(db_fk, "ENG")

    param = models.ParameterDef(id="P1", position=1, name="P", is_active=True)
    q = models.Question(id="Q1", parameter_id="P1", text="?")
    db_fk.add_all([param, q])
    db_fk.flush()
    db_fk.add(models.Answer(language_id="ENG", question_id="Q1", response_text="yes"))
    db_fk.add(models.LanguageParameter(language_id="ENG", parameter_id="P1", value_orig="+"))
    db_fk.add(models.LanguageParameterStatus(language_id="ENG", parameter_id="P1", is_unsure=False))
    db_fk.commit()

    payload = _put_item_from(lang, "EngTest")
    update_admin_language("ENG", payload, db=db_fk, current_user=user)

    # i figli seguono il nuovo id (ON UPDATE CASCADE)
    assert db_fk.query(models.Answer).filter_by(language_id="EngTest").count() == 1
    assert db_fk.query(models.Answer).filter_by(language_id="ENG").count() == 0
    assert db_fk.query(models.LanguageParameter).filter_by(language_id="EngTest").count() == 1
    assert db_fk.query(models.LanguageParameterStatus).filter_by(language_id="EngTest").count() == 1


def test_rename_empty_id_rejected(db_fk):
    user = _admin(db_fk)
    lang = _seed_lang(db_fk, "ENG")
    payload = _put_item_from(lang, "   ")  # solo spazi = vuoto
    with pytest.raises(HTTPException) as exc:
        update_admin_language("ENG", payload, db=db_fk, current_user=user)
    assert exc.value.status_code == 422


def test_rename_too_long_rejected(db_fk):
    user = _admin(db_fk)
    lang = _seed_lang(db_fk, "ENG")
    payload = _put_item_from(lang, "X" * 11)
    with pytest.raises(HTTPException) as exc:
        update_admin_language("ENG", payload, db=db_fk, current_user=user)
    assert exc.value.status_code == 422


def test_rename_to_existing_id_rejected(db_fk):
    user = _admin(db_fk)
    lang = _seed_lang(db_fk, "ENG")
    db_fk.add(models.Language(id="ITA", name_full="It", position=2))
    db_fk.commit()
    payload = _put_item_from(lang, "ITA")
    with pytest.raises(HTTPException) as exc:
        update_admin_language("ENG", payload, db=db_fk, current_user=user)
    assert exc.value.status_code == 409


def test_rename_to_alias_of_other_language_rejected(db_fk):
    user = _admin(db_fk)
    a = _seed_lang(db_fk, "A_NEW")
    db_fk.add(models.LanguageAlias(language_id="A_NEW", old_id="OldA"))
    b = models.Language(id="B", name_full="B", position=2)
    db_fk.add(b)
    db_fk.commit()
    # "OldA" è già alias di A_NEW
    payload = _put_item_from(b, "OldA")
    with pytest.raises(HTTPException) as exc:
        update_admin_language("B", payload, db=db_fk, current_user=user)
    assert exc.value.status_code == 409


def test_rename_cycle_removes_self_alias(db_fk):
    user = _admin(db_fk)
    lang = _seed_lang(db_fk, "ENG")

    update_admin_language("ENG", _put_item_from(lang, "EngTest"), db=db_fk, current_user=user)
    lang2 = db_fk.query(models.Language).filter_by(id="EngTest").one()
    update_admin_language("EngTest", _put_item_from(lang2, "ENG"), db=db_fk, current_user=user)

    aliases = db_fk.query(models.LanguageAlias).filter_by(language_id="ENG").all()
    old_ids = sorted(a.old_id for a in aliases)
    assert "EngTest" in old_ids
    assert "ENG" not in old_ids


def _build_languages_xlsx(rows: list[dict]) -> bytes:
    """Xlsx minimo con il solo sheet Languages."""
    wb = Workbook()
    wb.remove(wb.active)
    ws = wb.create_sheet("Languages")
    headers = ["ID", "Name", "Glottocode", "Position"]
    ws.append(headers)
    for r in rows:
        ws.append([r.get("ID"), r.get("Name"), r.get("Glottocode", ""), r.get("Position", 1)])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_excel_import_metadata_uses_alias(db_fk):
    """Id vecchio nel file: aggiorna la lingua, non la duplica."""
    from services.excel_import import import_excel
    user = _admin(db_fk)
    _seed_lang(db_fk, "ENG", glotto="stan1293")
    db_fk.add(models.LanguageAlias(language_id="ENG", old_id="Engl"))
    db_fk.commit()

    data = _build_languages_xlsx([
        {"ID": "Engl", "Name": "English (renamed)", "Glottocode": "stan1293"}
    ])
    report = import_excel(db_fk, data, user.id, create_missing=True)
    db_fk.commit()

    langs = db_fk.query(models.Language).all()
    assert len(langs) == 1
    assert langs[0].id == "ENG"  # resta l'id corrente
    assert langs[0].name_full == "English (renamed)"


def test_excel_import_metadata_glottocode_mismatch_reports_error(db_fk):
    """Alias giusto ma glottocode diverso: riga in errore, nessun update."""
    from services.excel_import import import_excel
    user = _admin(db_fk)
    _seed_lang(db_fk, "ENG", glotto="stan1293")
    db_fk.add(models.LanguageAlias(language_id="ENG", old_id="Engl"))
    db_fk.commit()

    data = _build_languages_xlsx([
        {"ID": "Engl", "Name": "WRONG LANGUAGE", "Glottocode": "ital1282"}
    ])
    report = import_excel(db_fk, data, user.id, create_missing=True)
    db_fk.commit()

    assert any("Glottocode mismatch" in (e.reason or "") for e in report.errors)
    lang = db_fk.query(models.Language).filter_by(id="ENG").one()
    assert lang.name_full != "WRONG LANGUAGE"
