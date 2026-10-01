"""Heartbeat della presence: righe scadute, conteggio degli altri, riga propria scaduta."""
from datetime import timedelta

import models
from routers.presence import PRESENCE_TTL_SECONDS, PresencePayload, heartbeat
from time_utils import utc_now

PAYLOAD = PresencePayload(entity_type="language_parameter", entity_id="BUL:NQP")


def _user(db_session, email):
    user = models.User(email=email, hashed_password="x", name="N", surname="S", role="user")
    db_session.add(user)
    db_session.commit()
    return user


def _session_row(db_session, user, seconds_ago):
    db_session.add(models.EditingSession(
        entity_type=PAYLOAD.entity_type, entity_id=PAYLOAD.entity_id, user_id=user.id,
        last_heartbeat=utc_now() - timedelta(seconds=seconds_ago),
    ))
    db_session.commit()


def _rows(db_session, user):
    return db_session.query(models.EditingSession).filter_by(user_id=user.id).all()


def test_first_heartbeat_creates_the_row(db_session):
    me = _user(db_session, "me@test.it")
    assert heartbeat(PAYLOAD, db=db_session, current_user=me) == {"others": 0}
    assert len(_rows(db_session, me)) == 1


def test_own_expired_row_is_renewed_without_errors(db_session):
    # il segnale precedente è scaduto (portatile in sospensione, sito carico)
    me = _user(db_session, "me@test.it")
    _session_row(db_session, me, seconds_ago=PRESENCE_TTL_SECONDS * 2)

    heartbeat(PAYLOAD, db=db_session, current_user=me)

    rows = _rows(db_session, me)
    assert len(rows) == 1
    assert rows[0].last_heartbeat > utc_now() - timedelta(seconds=PRESENCE_TTL_SECONDS)


def test_active_colleague_is_counted(db_session):
    me = _user(db_session, "me@test.it")
    colleague = _user(db_session, "col@test.it")
    _session_row(db_session, colleague, seconds_ago=5)
    assert heartbeat(PAYLOAD, db=db_session, current_user=me) == {"others": 1}


def test_expired_colleague_is_removed_and_not_counted(db_session):
    me = _user(db_session, "me@test.it")
    colleague = _user(db_session, "col@test.it")
    _session_row(db_session, colleague, seconds_ago=PRESENCE_TTL_SECONDS * 2)
    assert heartbeat(PAYLOAD, db=db_session, current_user=me) == {"others": 0}
    assert _rows(db_session, colleague) == []
