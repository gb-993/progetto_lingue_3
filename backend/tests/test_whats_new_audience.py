"""Audience del What's New: 'all' (default) o solo 'admins'."""
import models
from routers.whats_new import (
    _content_visible_to,
    _get_audience,
    WHATS_NEW_AUDIENCE_KEY,
    _DEFAULT_AUDIENCE,
)


def test_visibility_rule():
    # admin vede sempre; gli altri solo con 'all'
    assert _content_visible_to(True, "admins") is True
    assert _content_visible_to(True, "all") is True
    assert _content_visible_to(False, "all") is True
    assert _content_visible_to(False, "admins") is False


def test_get_audience_default_when_missing(db_session):
    assert _get_audience(db_session) == _DEFAULT_AUDIENCE == "all"


def test_get_audience_reads_row(db_session):
    db_session.add(models.SiteContent(key=WHATS_NEW_AUDIENCE_KEY, content="admins"))
    db_session.commit()
    assert _get_audience(db_session) == "admins"


def test_get_audience_clamps_invalid(db_session):
    db_session.add(models.SiteContent(key=WHATS_NEW_AUDIENCE_KEY, content="bogus"))
    db_session.commit()
    assert _get_audience(db_session) == _DEFAULT_AUDIENCE
