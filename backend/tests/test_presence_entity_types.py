"""Contratto dell'allowlist dei tipi di presence (routers/presence).

Garantisce che il tipo 'language_parameter' usato dalla sezione Data resti
accettato e che la chiave combinata "<langId>:<paramId>" stia nel limite di
lunghezza del validator. Difende dal rimuovere per sbaglio la voce dall'allowlist.
"""
import pytest
from pydantic import ValidationError

from routers.presence import PresencePayload, _ALLOWED_ENTITY_TYPES


def test_language_parameter_type_is_allowed():
    assert "language_parameter" in _ALLOWED_ENTITY_TYPES
    p = PresencePayload(entity_type="language_parameter", entity_id="ITA:P1")
    assert p.entity_type == "language_parameter"
    assert p.entity_id == "ITA:P1"


def test_combined_lang_param_id_fits_validator():
    # langId(<=10) + ':' + paramId(<=10) = max 21 char, entro il limite di 40.
    p = PresencePayload(entity_type="language_parameter", entity_id="Lang012345:Param01234")
    assert p.entity_id == "Lang012345:Param01234"


def test_unknown_entity_type_is_rejected():
    with pytest.raises(ValidationError):
        PresencePayload(entity_type="bogus", entity_id="x")


def test_existing_types_still_allowed():
    # Non regredire i tipi preesistenti.
    assert {"question", "parameter"} <= _ALLOWED_ENTITY_TYPES
