"""Test unit del resolver `resolve_language`.

Verifica:
  - match per id corrente (no alias)
  - match per alias storico
  - mismatch di glottocode segnalato come tale (lingua restituita comunque)
  - alias orfano (lingua puntata cancellata) -> miss
  - id assente -> miss
"""
import models
from services.language_alias import resolve_language


def _make_lang(db, lid: str, glotto: str = "") -> models.Language:
    lang = models.Language(
        id=lid, name_full=f"Lang {lid}", position=1, glottocode=glotto,
    )
    db.add(lang)
    db.commit()
    return lang


def test_resolve_by_current_id_no_alias(db_session):
    _make_lang(db_session, "ENG", glotto="stan1293")
    res = resolve_language(db_session, "ENG")
    assert res.language is not None
    assert res.language.id == "ENG"
    assert res.matched_via_alias is False
    assert res.glottocode_mismatch is None


def test_resolve_by_alias(db_session):
    lang = _make_lang(db_session, "ENG", glotto="stan1293")
    db_session.add(models.LanguageAlias(language_id=lang.id, old_id="Engl"))
    db_session.commit()

    res = resolve_language(db_session, "Engl")
    assert res.language is not None
    assert res.language.id == "ENG"
    assert res.matched_via_alias is True
    assert res.glottocode_mismatch is None


def test_resolve_alias_with_glottocode_match_passes(db_session):
    lang = _make_lang(db_session, "ENG", glotto="stan1293")
    db_session.add(models.LanguageAlias(language_id=lang.id, old_id="Engl"))
    db_session.commit()

    res = resolve_language(db_session, "Engl", file_glottocode="stan1293")
    assert res.language is not None
    assert res.matched_via_alias is True
    assert res.glottocode_mismatch is None


def test_resolve_alias_with_glottocode_mismatch_reports(db_session):
    lang = _make_lang(db_session, "ENG", glotto="stan1293")
    db_session.add(models.LanguageAlias(language_id=lang.id, old_id="Engl"))
    db_session.commit()

    res = resolve_language(db_session, "Engl", file_glottocode="ital1282")
    # Lingua trovata MA mismatch segnalato (il chiamante decide se applicare).
    assert res.language is not None
    assert res.matched_via_alias is True
    assert res.glottocode_mismatch is not None
    assert "ital1282" in res.glottocode_mismatch
    assert "stan1293" in res.glottocode_mismatch


def test_resolve_alias_with_empty_glottocode_skips_check(db_session):
    """Se uno dei due glottocode e' vuoto, il check va saltato (best effort)."""
    lang = _make_lang(db_session, "ENG", glotto="")  # nessun glottocode su DB
    db_session.add(models.LanguageAlias(language_id=lang.id, old_id="Engl"))
    db_session.commit()

    res = resolve_language(db_session, "Engl", file_glottocode="ital1282")
    assert res.language is not None
    assert res.glottocode_mismatch is None


def test_resolve_unknown_id_returns_none(db_session):
    _make_lang(db_session, "ENG")
    res = resolve_language(db_session, "XX_UNKNOWN")
    assert res.language is None
    assert res.matched_via_alias is False


def test_resolve_empty_id_returns_none(db_session):
    res = resolve_language(db_session, "")
    assert res.language is None
