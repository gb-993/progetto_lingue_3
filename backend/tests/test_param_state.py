"""Test della logica colore dei quadratini (services/param_state)."""
import models
from services.param_state import (
    param_color, compute_colors, flag_parameter_needs_review,
    GREY, RED, YELLOW, GREEN,
)


def _c(responses, ex_counts=None, has_test=False, needs_review=False):
    qids = list(responses.keys())
    return param_color(qids, responses, ex_counts or {}, has_test, needs_review)


# ---- funzione pura ----

def test_no_active_questions_is_grey():
    assert param_color([], {}, {}, False, False) == GREY

def test_all_empty_is_grey():
    assert _c({"q1": None, "q2": None}) == GREY

def test_partial_missing_answer_is_red():
    assert _c({"q1": "yes", "q2": None}, {"q1": 2}) == RED

def test_unsure_is_red():
    assert _c({"q1": "unsure"}) == RED

def test_missing_is_yellow():
    # MISSING = dato non disponibile ma acknowledged → giallo, non rosso
    assert _c({"q1": "missing"}) == YELLOW

def test_all_missing_is_yellow():
    assert _c({"q1": "missing", "q2": "missing"}) == YELLOW

def test_missing_with_yes_is_yellow():
    assert _c({"q1": "missing", "q2": "yes"}, {"q2": 2}) == YELLOW

def test_missing_plus_empty_is_red():
    # una domanda è ancora senza risposta → rosso vince
    assert _c({"q1": "missing", "q2": None}) == RED

def test_missing_plus_unsure_is_red():
    assert _c({"q1": "missing", "q2": "unsure"}) == RED

def test_all_resolved_with_examples_is_green():
    assert _c({"q1": "yes", "q2": "no"}, {"q1": 2}) == GREEN

def test_all_no_is_green():
    assert _c({"q1": "no", "q2": "no"}) == GREEN

def test_yes_with_few_examples_is_yellow():
    assert _c({"q1": "yes"}, {"q1": 1}) == YELLOW

def test_test_example_is_yellow():
    # esempi sufficienti ma uno è di test → giallo
    assert _c({"q1": "yes"}, {"q1": 2}, has_test=True) == YELLOW

def test_needs_review_is_yellow():
    assert _c({"q1": "yes", "q2": "no"}, {"q1": 2}, needs_review=True) == YELLOW

def test_red_beats_yellow():
    # manca una risposta E needs_review → vince il rosso
    assert _c({"q1": "yes", "q2": None}, {"q1": 2}, needs_review=True) == RED


# ---- batch + flag (con DB) ----

def _seed(db):
    db.add(models.Language(id="ITA", name_full="Italiano", position=1))
    db.add(models.ParameterDef(id="P1", position=1, name="P1", is_active=True))
    db.add(models.Question(id="P1_01", parameter_id="P1", text="q1", is_active=True))
    db.add(models.Question(id="P1_02", parameter_id="P1", text="q2", is_active=True))
    db.commit()


def test_compute_colors_and_flag(db_session):
    _seed(db_session)
    qids = ["P1_01", "P1_02"]
    pq = {"P1": qids}

    # nessuna risposta → grey
    assert compute_colors(db_session, ["ITA"], pq)[("ITA", "P1")] == GREY

    # una risposta yes (con 2 esempi) + una mancante → red
    a1 = models.Answer(language_id="ITA", question_id="P1_01", response_text="yes")
    db_session.add(a1); db_session.flush()
    db_session.add(models.Example(answer_id=a1.id, textarea="e1"))
    db_session.add(models.Example(answer_id=a1.id, textarea="e2"))
    db_session.commit()
    assert compute_colors(db_session, ["ITA"], pq)[("ITA", "P1")] == RED

    # entrambe risolte con esempi → green
    a2 = models.Answer(language_id="ITA", question_id="P1_02", response_text="no")
    db_session.add(a2)
    db_session.commit()
    assert compute_colors(db_session, ["ITA"], pq)[("ITA", "P1")] == GREEN

    # marco un esempio come test → yellow
    ex = db_session.query(models.Example).first()
    ex.is_test = True
    db_session.commit()
    assert compute_colors(db_session, ["ITA"], pq)[("ITA", "P1")] == YELLOW
    ex.is_test = False
    db_session.commit()

    # flag needs_review (modifica seria) → yellow; tocca solo lingue con lavoro
    flag_parameter_needs_review(db_session, "P1")
    db_session.commit()
    st = db_session.query(models.LanguageParameterStatus).filter_by(
        language_id="ITA", parameter_id="P1").one()
    assert st.needs_review is True
    assert compute_colors(db_session, ["ITA"], pq)[("ITA", "P1")] == YELLOW
