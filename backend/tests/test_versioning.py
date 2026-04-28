"""
Test per il sistema di versionamento (EntityVersion).
"""
import pytest
import models
from services.versioning import (
    record_version, serialize_entity, compute_diff,
    get_previous_version, ENTITY_TYPE_MAP,
)


def test_serialize_entity_includes_all_columns(db_session):
    p = models.ParameterDef(
        id="FGM", position=1, name="Test", short_description="hello",
        is_active=True, schema="A", param_type="B",
    )
    db_session.add(p); db_session.commit()
    snap = serialize_entity(p)
    assert snap["id"] == "FGM"
    assert snap["name"] == "Test"
    assert snap["short_description"] == "hello"
    assert snap["is_active"] is True
    assert snap["schema"] == "A"


def test_record_version_creates_row(db_session):
    user = models.User(id=1, email="x@x.it", hashed_password="x", role="admin")
    db_session.add(user)
    p = models.ParameterDef(id="FGM", position=1, name="Test", is_active=True)
    db_session.add(p); db_session.commit()

    v = record_version(db_session, p, operation="create", source="manual", user_id=user.id)
    db_session.commit()

    assert v.id is not None
    assert v.entity_type == "parameter"
    assert v.entity_id == "FGM"
    assert v.operation == "create"
    assert v.source == "manual"
    assert v.snapshot["name"] == "Test"


def test_record_multiple_versions_track_history(db_session):
    user = models.User(id=1, email="x@x.it", hashed_password="x", role="admin")
    db_session.add(user)
    p = models.ParameterDef(id="FGM", position=1, name="v1", is_active=True)
    db_session.add(p); db_session.commit()

    record_version(db_session, p, operation="create", source="manual", user_id=user.id)
    db_session.commit()

    p.name = "v2"
    db_session.commit()
    record_version(db_session, p, operation="update", source="manual", user_id=user.id)
    db_session.commit()

    p.name = "v3"
    db_session.commit()
    record_version(db_session, p, operation="update", source="excel_import", user_id=user.id)
    db_session.commit()

    versions = db_session.query(models.EntityVersion).filter_by(
        entity_type="parameter", entity_id="FGM"
    ).order_by(models.EntityVersion.id).all()

    assert len(versions) == 3
    assert [v.snapshot["name"] for v in versions] == ["v1", "v2", "v3"]
    assert versions[2].source == "excel_import"


def test_get_previous_version(db_session):
    user = models.User(id=1, email="x@x.it", hashed_password="x", role="admin")
    db_session.add(user)
    p = models.ParameterDef(id="FGM", position=1, name="A", is_active=True)
    db_session.add(p); db_session.commit()

    v1 = record_version(db_session, p, user_id=user.id)
    db_session.commit()

    p.name = "B"
    db_session.commit()
    v2 = record_version(db_session, p, user_id=user.id)
    db_session.commit()

    prev = get_previous_version(db_session, "parameter", "FGM", v2.id)
    assert prev is not None
    assert prev.id == v1.id
    assert prev.snapshot["name"] == "A"


def test_compute_diff_basic():
    prev = {"name": "A", "is_active": True, "position": 1}
    curr = {"name": "B", "is_active": True, "position": 1}
    diff = compute_diff(prev, curr)
    assert "name" in diff
    assert diff["name"] == {"old": "A", "new": "B"}
    assert "is_active" not in diff


def test_compute_diff_create():
    """Senza prev, tutti i campi non-null sono 'new'."""
    diff = compute_diff(None, {"name": "A", "comment": ""})
    assert "name" in diff
    assert "comment" not in diff  # vuoto = ignorato


def test_entity_type_for_models(db_session):
    p = models.ParameterDef(id="FGM", position=1, name="x", is_active=True)
    db_session.add(p); db_session.commit()

    v = record_version(db_session, p)
    assert v.entity_type == "parameter"

    q = models.Question(id="FGM_01", parameter_id="FGM", text="t", is_active=True)
    db_session.add(q); db_session.commit()
    v = record_version(db_session, q)
    assert v.entity_type == "question"

    m = models.Motivation(code="X", label="x")
    db_session.add(m); db_session.commit()
    v = record_version(db_session, m)
    assert v.entity_type == "motivation"

    lang = models.Language(id="ITA", name_full="Italian", position=1)
    db_session.add(lang); db_session.commit()
    v = record_version(db_session, lang)
    assert v.entity_type == "language"
