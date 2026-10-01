"""Valori finali: condizioni vere/false, incertezza che si propaga, condizioni inutilizzabili."""
import pytest
from pyparsing import ParseException

import models
from services.dag_eval import formula_problems, run_dag_for_language
from services.logic_parser import evaluate_with_parser, parse_condition


def _seed(db, params, origs, warnings=()):
    """params: id -> condizione (o None); origs: id -> valore grezzo."""
    db.add(models.Language(id="ITA", name_full="Italiano", position=1))
    for position, (pid, cond) in enumerate(params.items(), start=1):
        db.add(models.ParameterDef(id=pid, name=pid, position=position, is_active=True,
                                   implicational_condition=cond))
    for pid, value in origs.items():
        db.add(models.LanguageParameter(language_id="ITA", parameter_id=pid, value_orig=value,
                                        warning_orig=pid in warnings))
    db.commit()


def _finals(db):
    rows = (
        db.query(models.LanguageParameter.parameter_id, models.LanguageParameterEval.value_eval)
        .join(models.LanguageParameterEval,
              models.LanguageParameterEval.language_parameter_id == models.LanguageParameter.id)
        .filter(models.LanguageParameter.language_id == "ITA")
        .all()
    )
    return dict(rows)


def test_condition_true_keeps_the_raw_value_and_false_gives_zero(db_session):
    _seed(db_session,
          {"A": None, "B": None, "YES": "+A & -B", "NO": "+B", "DEEP": "0NO"},
          {"A": "+", "B": "-", "YES": "+", "NO": "+", "DEEP": "-"})
    report = run_dag_for_language("ITA", db_session)

    assert _finals(db_session) == {"A": "+", "B": "-", "YES": "+", "NO": "0", "DEEP": "-"}
    assert report.forced_zero == ["NO"]
    assert report.formula_errors == []


def test_missing_raw_value_is_uncertain_and_propagates(db_session):
    _seed(db_session,
          {"A": None, "CHILD": "+A", "GRANDCHILD": "+CHILD"},
          {"CHILD": "+", "GRANDCHILD": "+"})
    report = run_dag_for_language("ITA", db_session)

    assert _finals(db_session) == {"A": "?", "CHILD": "?", "GRANDCHILD": "?"}
    assert report.warnings_propagated == ["CHILD", "GRANDCHILD"]


def test_conflict_on_answers_is_uncertain(db_session):
    _seed(db_session, {"A": None, "CHILD": "+A"}, {"A": "+", "CHILD": "-"}, warnings={"A"})
    run_dag_for_language("ITA", db_session)
    assert _finals(db_session) == {"A": "?", "CHILD": "?"}


def test_zero_is_certain_and_stops_the_warning(db_session):
    # ZERO ha un conflitto sulle risposte, ma la condizione falsa lo rende 0 certo
    _seed(db_session,
          {"A": None, "ZERO": "+A", "CHILD": "0ZERO"},
          {"A": "-", "ZERO": "+", "CHILD": "+"}, warnings={"ZERO"})
    run_dag_for_language("ITA", db_session)
    assert _finals(db_session) == {"A": "-", "ZERO": "0", "CHILD": "+"}


def test_cycle_gives_question_marks_and_is_reported(db_session):
    _seed(db_session,
          {"A": "+B", "B": "+A", "AFTER": "+A", "FREE": None},
          {"A": "+", "B": "+", "AFTER": "+", "FREE": "-"})
    report = run_dag_for_language("ITA", db_session)

    assert _finals(db_session) == {"A": "?", "B": "?", "AFTER": "?", "FREE": "-"}
    errors = {pid: reason for pid, _cond, reason in report.formula_errors}
    assert set(errors) == {"A", "B"}
    assert "circular dependency: A → B → A" in errors["A"]
    assert report.warnings_propagated == ["AFTER"]


def test_condition_citing_a_deactivated_parameter_is_reported(db_session):
    _seed(db_session, {"A": None, "P": "+A & +OFF"}, {"A": "+", "P": "+"})
    db_session.add(models.ParameterDef(id="OFF", name="OFF", position=9, is_active=False))
    db_session.commit()
    report = run_dag_for_language("ITA", db_session)

    assert _finals(db_session) == {"A": "+", "P": "?"}
    assert report.formula_errors == [
        ("P", "+A & +OFF", "cites parameters that do not exist or are deactivated: OFF"),
    ]


def test_unreadable_condition_is_reported_not_turned_into_zero(db_session):
    _seed(db_session, {"A": None, "BAD": "+A &", "CHILD": "+BAD"}, {"A": "+", "BAD": "+", "CHILD": "+"})
    report = run_dag_for_language("ITA", db_session)

    assert _finals(db_session) == {"A": "+", "BAD": "?", "CHILD": "?"}
    assert [pid for pid, _cond, _reason in report.formula_errors] == ["BAD"]
    assert "wrong formula syntax" in report.formula_errors[0][2]

    problems = formula_problems(db_session)
    assert [p["param_id"] for p in problems] == ["BAD"]
    assert problems[0]["condition"] == "+A &"


def test_rerun_gives_the_same_values(db_session):
    _seed(db_session, {"A": None, "B": "+A", "C": "-B | 0B"}, {"A": "-", "B": "+", "C": "+"})
    run_dag_for_language("ITA", db_session)
    db_session.commit()
    first = _finals(db_session)
    run_dag_for_language("ITA", db_session)
    db_session.commit()
    assert _finals(db_session) == first == {"A": "-", "B": "0", "C": "+"}


def test_evaluate_with_parser_raises_on_wrong_syntax():
    assert evaluate_with_parser("+A & not -B", {"A": "+", "B": "+"}) is True
    assert evaluate_with_parser("+A | 0B", {"A": "-", "B": "-"}) is False
    assert evaluate_with_parser("", {}) is True
    with pytest.raises(ParseException):
        evaluate_with_parser("+A &", {"A": "+"})


def test_parse_condition_is_remembered():
    assert parse_condition("+A & -B") is parse_condition("+A & -B")
