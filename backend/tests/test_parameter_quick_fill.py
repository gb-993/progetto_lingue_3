"""Test del quick-fill answers per un parametro.

Endpoint: POST /api/admin/parameters/{id}/quick-fill-answers

Comportamento atteso:
  - crea Answer 'no' su question normali, 'yes' su stop, dove la combinazione
    (lingua, question) non ha gia' un'Answer
  - non sovrascrive risposte gia' presenti
  - ignora le question is_active=False
  - parametro disattivato -> 409
  - parametro senza question attive -> 400
  - 404 se id sconosciuto
  - una EntityVersion aggregata viene registrata
"""
import pytest
from fastapi import HTTPException, BackgroundTasks
from sqlalchemy import text

import models
from routers.parameters import quick_fill_parameter_answers


@pytest.fixture
def db_fk(db_session):
    db_session.execute(text("PRAGMA foreign_keys = ON"))
    return db_session


def _admin(db) -> models.User:
    u = models.User(id=1, email="a@b.it", hashed_password="x", role="admin")
    db.add(u); db.commit()
    return u


def _seed(db, *, with_stop=True, q_inactive=False, param_active=True, n_langs=2):
    param = models.ParameterDef(
        id="P1", position=1, name="P", is_active=param_active,
    )
    db.add(param)
    db.flush()
    qs = []
    qs.append(models.Question(id="Q_NORM_1", parameter_id="P1", text="?", is_stop_question=False, is_active=True))
    qs.append(models.Question(id="Q_NORM_2", parameter_id="P1", text="?", is_stop_question=False, is_active=True))
    if with_stop:
        qs.append(models.Question(id="Q_STOP", parameter_id="P1", text="?", is_stop_question=True, is_active=True))
    if q_inactive:
        qs.append(models.Question(id="Q_DEAD", parameter_id="P1", text="?", is_stop_question=False, is_active=False))
    db.add_all(qs)
    for i in range(n_langs):
        db.add(models.Language(id=f"L{i}", name_full=f"Lang {i}", position=i + 1))
    db.commit()
    return param


def test_quick_fill_creates_no_on_normal_and_yes_on_stop(db_fk):
    user = _admin(db_fk)
    _seed(db_fk, with_stop=True, n_langs=3)

    res = quick_fill_parameter_answers(
        "P1", BackgroundTasks(), db=db_fk, current_user=user,
    )
    db_fk.commit()

    # 3 lingue x 3 question = 9 nuove Answer
    assert res["created"] == 9
    assert res["skipped_existing"] == 0
    assert res["languages_touched"] == 3

    # I valori sono coerenti col tipo della question
    norms = db_fk.query(models.Answer).filter(models.Answer.question_id.like("Q_NORM_%")).all()
    stops = db_fk.query(models.Answer).filter(models.Answer.question_id == "Q_STOP").all()
    assert len(norms) == 6 and all(a.response_text == "no" for a in norms)
    assert len(stops) == 3 and all(a.response_text == "yes" for a in stops)
    # Status di default
    assert all(a.status == "pending" for a in norms + stops)


def test_quick_fill_does_not_overwrite_existing(db_fk):
    user = _admin(db_fk)
    _seed(db_fk, with_stop=False, n_langs=2)
    # Risposta pre-esistente "yes" su (L0, Q_NORM_1)
    db_fk.add(models.Answer(
        language_id="L0", question_id="Q_NORM_1",
        response_text="yes", status="approved", comments="manual",
    ))
    db_fk.commit()

    res = quick_fill_parameter_answers(
        "P1", BackgroundTasks(), db=db_fk, current_user=user,
    )
    db_fk.commit()

    # 2 lingue x 2 normal = 4 combinazioni - 1 esistente = 3 created
    assert res["created"] == 3
    assert res["skipped_existing"] == 1

    # La risposta pre-esistente e' stata preservata identica
    a = db_fk.query(models.Answer).filter_by(language_id="L0", question_id="Q_NORM_1").one()
    assert a.response_text == "yes"
    assert a.status == "approved"
    assert a.comments == "manual"


def test_quick_fill_ignores_inactive_questions(db_fk):
    user = _admin(db_fk)
    _seed(db_fk, with_stop=False, q_inactive=True, n_langs=2)

    res = quick_fill_parameter_answers(
        "P1", BackgroundTasks(), db=db_fk, current_user=user,
    )
    db_fk.commit()

    # Solo 2 question attive x 2 lingue = 4 (Q_DEAD non viene toccata)
    assert res["created"] == 4
    assert db_fk.query(models.Answer).filter_by(question_id="Q_DEAD").count() == 0


def test_quick_fill_blocked_when_parameter_deactivated(db_fk):
    user = _admin(db_fk)
    _seed(db_fk, param_active=False, n_langs=1)
    with pytest.raises(HTTPException) as exc:
        quick_fill_parameter_answers("P1", BackgroundTasks(), db=db_fk, current_user=user)
    assert exc.value.status_code == 409


def test_quick_fill_blocked_when_no_active_questions(db_fk):
    user = _admin(db_fk)
    param = models.ParameterDef(id="EMPTY", position=1, name="E", is_active=True)
    db_fk.add(param)
    # Una sola question, ma disattivata
    db_fk.add(models.Question(id="Q_DEAD", parameter_id="EMPTY", text="?", is_active=False))
    db_fk.add(models.Language(id="L0", name_full="L", position=1))
    db_fk.commit()

    with pytest.raises(HTTPException) as exc:
        quick_fill_parameter_answers("EMPTY", BackgroundTasks(), db=db_fk, current_user=user)
    assert exc.value.status_code == 400


def test_quick_fill_404_on_missing_parameter(db_fk):
    user = _admin(db_fk)
    with pytest.raises(HTTPException) as exc:
        quick_fill_parameter_answers("NOPE", BackgroundTasks(), db=db_fk, current_user=user)
    assert exc.value.status_code == 404


def test_quick_fill_records_aggregate_history_entry(db_fk):
    user = _admin(db_fk)
    _seed(db_fk, with_stop=True, n_langs=2)

    quick_fill_parameter_answers("P1", BackgroundTasks(), db=db_fk, current_user=user)
    db_fk.commit()

    versions = (
        db_fk.query(models.EntityVersion)
        .filter_by(entity_type="parameter", entity_id="P1")
        .all()
    )
    # Una SOLA entry aggregata
    assert len(versions) == 1
    v = versions[0]
    assert v.operation == "update"
    assert "Quick-fill" in (v.note or "")
    # La nota riporta i conteggi totali
    assert "6" in v.note  # 2 lingue x 3 question = 6 created


def test_quick_fill_empty_when_no_languages(db_fk):
    """Senza lingue il fill non fa nulla ma non esplode."""
    user = _admin(db_fk)
    param = models.ParameterDef(id="P1", position=1, name="P", is_active=True)
    db_fk.add(param)
    db_fk.add(models.Question(id="Q", parameter_id="P1", text="?", is_active=True))
    db_fk.commit()

    res = quick_fill_parameter_answers("P1", BackgroundTasks(), db=db_fk, current_user=user)
    db_fk.commit()
    assert res["created"] == 0
    assert res["languages_touched"] == 0


# ============================================================================
# Test end-to-end con recompute reale.
#
# Il quick-fill schedula `recompute_parameter_for_all_languages` come
# BackgroundTask. Nei test BackgroundTasks() non esegue nulla, quindi qui
# replichiamo a mano la logica del wrapper (consolidate + DAG per ogni
# lingua) usando la stessa session del test. Verifichiamo che dopo
# quick-fill + recompute la tabella `language_parameters` rifletta i nuovi
# value_orig coerenti con le regole di consolidamento.
# ============================================================================

def _recompute_param_for_all_langs(db, parameter_id: str) -> None:
    """Equivalente del wrapper recompute_parameter_for_all_languages ma
    usando la session del test invece di aprirne una propria via SessionLocal."""
    from services.param_consolidate import recompute_and_persist_language_parameter
    from services.dag_eval import run_dag_for_language
    for (lang_id,) in db.query(models.Language.id).all():
        recompute_and_persist_language_parameter(lang_id, parameter_id, db)
        run_dag_for_language(lang_id, db)
        db.flush()


def test_quick_fill_then_recompute_gives_minus_with_stop_yes(db_fk):
    """Dopo quick-fill (stop=yes, normali=no), value_orig deve essere '-'
    su tutte le lingue: nessun YES su normali, almeno una stop YES → caso 2."""
    user = _admin(db_fk)
    _seed(db_fk, with_stop=True, n_langs=3)

    quick_fill_parameter_answers("P1", BackgroundTasks(), db=db_fk, current_user=user)
    db_fk.commit()

    _recompute_param_for_all_langs(db_fk, "P1")
    db_fk.commit()

    lps = db_fk.query(models.LanguageParameter).filter_by(parameter_id="P1").all()
    assert len(lps) == 3
    assert all(lp.value_orig == "-" for lp in lps), [lp.value_orig for lp in lps]
    assert all(lp.warning_orig is False for lp in lps)


def test_quick_fill_then_recompute_gives_minus_only_normals(db_fk):
    """Solo question normali, tutte risposte NO → caso 3 → '-'."""
    user = _admin(db_fk)
    _seed(db_fk, with_stop=False, n_langs=2)

    quick_fill_parameter_answers("P1", BackgroundTasks(), db=db_fk, current_user=user)
    db_fk.commit()

    _recompute_param_for_all_langs(db_fk, "P1")
    db_fk.commit()

    lps = db_fk.query(models.LanguageParameter).filter_by(parameter_id="P1").all()
    assert len(lps) == 2
    assert all(lp.value_orig == "-" for lp in lps), [lp.value_orig for lp in lps]


def test_quick_fill_then_recompute_respects_pre_existing_yes(db_fk):
    """L0 ha gia' 'yes' su una normale: dopo quick-fill + recompute il suo
    value_orig deve essere '+' (caso 1). L1 invece resta '-'."""
    user = _admin(db_fk)
    _seed(db_fk, with_stop=False, n_langs=2)
    db_fk.add(models.Answer(
        language_id="L0", question_id="Q_NORM_1",
        response_text="yes", status="approved",
    ))
    db_fk.commit()

    quick_fill_parameter_answers("P1", BackgroundTasks(), db=db_fk, current_user=user)
    db_fk.commit()

    _recompute_param_for_all_langs(db_fk, "P1")
    db_fk.commit()

    lp0 = db_fk.query(models.LanguageParameter).filter_by(
        language_id="L0", parameter_id="P1"
    ).one()
    lp1 = db_fk.query(models.LanguageParameter).filter_by(
        language_id="L1", parameter_id="P1"
    ).one()
    assert lp0.value_orig == "+", f"L0 should be '+' (has pre-existing yes), got {lp0.value_orig}"
    assert lp1.value_orig == "-", f"L1 should be '-' (all no), got {lp1.value_orig}"
