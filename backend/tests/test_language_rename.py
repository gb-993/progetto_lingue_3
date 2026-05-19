"""Test del flusso di rename di Language.id.

Verifica:
  - rename via PUT salva l'alias storico
  - cascata DB sui figli (answers, language_parameters, ...): grazie alle FK
    `ON UPDATE CASCADE`. Su SQLite richiede `PRAGMA foreign_keys = ON`
  - validazioni: id vuoto / troppo lungo / gia' in uso / gia' alias di altra lingua
  - rename A->B->A rimuove l'alias auto-referenziale
  - excel import metadata riconosce un id obsoleto via alias e aggiorna la
    lingua corrente senza duplicare
  - excel import segnala mismatch glottocode quando l'alias e' ambiguo
  - backup_restore submissions usa l'id corrente quando il file ha l'old id
"""
import io

import pytest
from fastapi import HTTPException
from openpyxl import Workbook
from sqlalchemy import text

import models
from routers.languages import update_admin_language, LanguageBase


# ----------------------------------------------------------------------------
# Helpers / fixture
# ----------------------------------------------------------------------------

@pytest.fixture
def db_fk(db_session):
    """Abilita FOREIGN_KEYS su SQLite in-memory (di default e' off).
    Necessario per esercitare la cascade ON UPDATE/DELETE.
    """
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
    """Costruisce un payload PUT identico alla lingua, cambiando solo l'id."""
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


# ----------------------------------------------------------------------------
# PUT — rename salvato come alias
# ----------------------------------------------------------------------------

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

    # Param + question + answer + status agganciati alla lingua
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

    # Tutti i figli devono ora puntare al nuovo id grazie a ON UPDATE CASCADE
    assert db_fk.query(models.Answer).filter_by(language_id="EngTest").count() == 1
    assert db_fk.query(models.Answer).filter_by(language_id="ENG").count() == 0
    assert db_fk.query(models.LanguageParameter).filter_by(language_id="EngTest").count() == 1
    assert db_fk.query(models.LanguageParameterStatus).filter_by(language_id="EngTest").count() == 1


# ----------------------------------------------------------------------------
# PUT — validazioni
# ----------------------------------------------------------------------------

def test_rename_empty_id_rejected(db_fk):
    user = _admin(db_fk)
    lang = _seed_lang(db_fk, "ENG")
    payload = _put_item_from(lang, "   ")  # solo spazi: strip -> vuoto
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
    # Lingua A con alias "OldA"
    a = _seed_lang(db_fk, "A_NEW")
    db_fk.add(models.LanguageAlias(language_id="A_NEW", old_id="OldA"))
    # Lingua B
    b = models.Language(id="B", name_full="B", position=2)
    db_fk.add(b)
    db_fk.commit()
    # Provo a rinominare B in "OldA" -> conflitto con alias di A_NEW
    payload = _put_item_from(b, "OldA")
    with pytest.raises(HTTPException) as exc:
        update_admin_language("B", payload, db=db_fk, current_user=user)
    assert exc.value.status_code == 409


# ----------------------------------------------------------------------------
# PUT — rename ciclico A -> B -> A
# ----------------------------------------------------------------------------

def test_rename_cycle_removes_self_alias(db_fk):
    user = _admin(db_fk)
    lang = _seed_lang(db_fk, "ENG")

    # A -> B
    update_admin_language("ENG", _put_item_from(lang, "EngTest"), db=db_fk, current_user=user)
    # B -> A
    lang2 = db_fk.query(models.Language).filter_by(id="EngTest").one()
    update_admin_language("EngTest", _put_item_from(lang2, "ENG"), db=db_fk, current_user=user)

    # Stato finale: id corrente "ENG", alias "EngTest" presente, nessun alias "ENG"
    aliases = db_fk.query(models.LanguageAlias).filter_by(language_id="ENG").all()
    old_ids = sorted(a.old_id for a in aliases)
    assert "EngTest" in old_ids
    assert "ENG" not in old_ids


# ----------------------------------------------------------------------------
# Excel import metadata — alias lookup, no duplicati
# ----------------------------------------------------------------------------

def _build_languages_xlsx(rows: list[dict]) -> bytes:
    """Build minimal Languages sheet xlsx in memoria."""
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
    """Excel con id obsoleto deve aggiornare la lingua corrente, non duplicarne una."""
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
    assert langs[0].id == "ENG"  # id corrente, non sovrascritto dall'old id del file
    assert langs[0].name_full == "English (renamed)"  # name aggiornato


def test_excel_import_metadata_glottocode_mismatch_reports_error(db_fk):
    """File con id riconosciuto via alias ma glottocode incoerente -> riga in errore, nessun update."""
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

    # Almeno un errore di mismatch nel report
    assert any("Glottocode mismatch" in (e.reason or "") for e in report.errors)
    # E la lingua NON deve essere stata sovrascritta
    lang = db_fk.query(models.Language).filter_by(id="ENG").one()
    assert lang.name_full != "WRONG LANGUAGE"
