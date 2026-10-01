"""Tipi di presence accettati (routers/presence)."""
import pytest
from pydantic import ValidationError

from routers.presence import PresencePayload, _ALLOWED_ENTITY_TYPES


def test_language_parameter_type_is_allowed():
    assert "language_parameter" in _ALLOWED_ENTITY_TYPES
    p = PresencePayload(entity_type="language_parameter", entity_id="ITA:P1")
    assert p.entity_type == "language_parameter"
    assert p.entity_id == "ITA:P1"


def test_combined_lang_param_id_fits_validator():
    # id max 10 + ':' + 10 = 21 char, limite 40
    p = PresencePayload(entity_type="language_parameter", entity_id="Lang012345:Param01234")
    assert p.entity_id == "Lang012345:Param01234"


def test_language_type_is_allowed():
    # usato da LanguageForm
    assert "language" in _ALLOWED_ENTITY_TYPES
    p = PresencePayload(entity_type="language", entity_id="ITA")
    assert p.entity_type == "language"
    assert p.entity_id == "ITA"


def test_unknown_entity_type_is_rejected():
    with pytest.raises(ValidationError):
        PresencePayload(entity_type="bogus", entity_id="x")


def test_existing_types_still_allowed():
    assert {"question", "parameter", "language", "language_parameter"} <= _ALLOWED_ENTITY_TYPES
