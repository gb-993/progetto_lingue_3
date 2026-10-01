"""Controllo consensi del middleware: chi deve ancora accettare i documenti legali."""
from datetime import datetime

import models
from consent_enforcement import user_missing_consent


def _seed(db_session):
    user = models.User(email="ling@test.it", hashed_password="x", name="Ling", surname="Uist", role="user")
    old_doc = models.LegalDocument(
        type="terms_of_use", version="v1.0", file_path="tou_v1.pdf",
        sha256="a" * 64, published_at=datetime(2026, 1, 1), is_current=False,
    )
    current_doc = models.LegalDocument(
        type="terms_of_use", version="v1.1", file_path="tou_v11.pdf",
        sha256="b" * 64, published_at=datetime(2026, 6, 1), is_current=True,
    )
    db_session.add_all([user, old_doc, current_doc])
    db_session.commit()
    return user, old_doc, current_doc


def _accept(db_session, user, doc, revoked=False):
    db_session.add(models.Consent(
        user_id=user.id, legal_document_id=doc.id, accepted_at=datetime(2026, 6, 2),
        method="first_login_modal", revoked_at=datetime(2026, 6, 3) if revoked else None,
    ))
    db_session.commit()


def test_missing_when_current_document_not_accepted(db_session):
    user, old_doc, _ = _seed(db_session)
    _accept(db_session, user, old_doc)
    assert user_missing_consent(db_session, str(user.id)) is True


def test_ok_when_current_document_accepted(db_session):
    user, _, current_doc = _seed(db_session)
    _accept(db_session, user, current_doc)
    assert user_missing_consent(db_session, str(user.id)) is False


def test_revoked_consent_does_not_count(db_session):
    user, _, current_doc = _seed(db_session)
    _accept(db_session, user, current_doc, revoked=True)
    assert user_missing_consent(db_session, str(user.id)) is True


def test_sub_as_email_is_resolved(db_session):
    user, _, current_doc = _seed(db_session)
    _accept(db_session, user, current_doc)
    assert user_missing_consent(db_session, "ling@test.it") is False


def test_unknown_user_is_not_blocked(db_session):
    _seed(db_session)
    assert user_missing_consent(db_session, "999") is False


def test_no_current_documents_means_nothing_to_accept(db_session):
    user = models.User(email="solo@test.it", hashed_password="x", name="S", surname="S", role="user")
    db_session.add(user)
    db_session.commit()
    assert user_missing_consent(db_session, str(user.id)) is False
