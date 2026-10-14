import models
from routers.compilation import get_language_compilation_data
from routers.parameters import get_parameter_by_language
from services.recompute import recompute_language


def _seed(db):
    db.add(models.Language(id="ITA", name_full="Italiano", position=1))
    for position, pid in enumerate(("CONF", "OK", "EMPTY"), start=1):
        db.add(models.ParameterDef(id=pid, name=pid, position=position, is_active=True))
        db.add(models.Question(id=f"{pid}_01", parameter_id=pid, text="q", is_active=True))
        db.add(models.Question(id=f"{pid}_S", parameter_id=pid, text="stop", is_active=True, is_stop_question=True))
    db.add_all([
        models.Answer(language_id="ITA", question_id="CONF_01", response_text="yes", status="approved"),
        models.Answer(language_id="ITA", question_id="CONF_S", response_text="yes", status="approved"),
        models.Answer(language_id="ITA", question_id="OK_01", response_text="yes", status="approved"),
        models.Answer(language_id="ITA", question_id="OK_S", response_text="no", status="approved"),
    ])
    db.commit()


def _conflicts(db):
    data = get_language_compilation_data("ITA", db=db, current_user=models.User(role="admin"))
    return {p["id"]: p["answer_conflict"] for p in data["parameters"]}


def test_answer_conflict_flags_only_question_and_stop_question_both_yes(db_session):
    _seed(db_session)
    recompute_language(db_session, "ITA")

    assert _conflicts(db_session) == {"CONF": True, "OK": False, "EMPTY": False}


def test_answer_conflict_is_false_before_any_computation(db_session):
    _seed(db_session)

    assert _conflicts(db_session) == {"CONF": False, "OK": False, "EMPTY": False}


def test_parameter_by_language_flags_answer_conflict(db_session):
    _seed(db_session)
    db_session.add(models.Language(id="ENG", name_full="English", position=2))
    db_session.add(models.Answer(language_id="ENG", question_id="CONF_01", response_text="yes", status="approved"))
    db_session.add(models.Answer(language_id="ENG", question_id="CONF_S", response_text="no", status="approved"))
    db_session.commit()
    recompute_language(db_session, "ITA")
    recompute_language(db_session, "ENG")

    data = get_parameter_by_language("CONF", db=db_session, current_user=models.User(role="admin"))

    assert {lang["id"]: lang["answer_conflict"] for lang in data["languages"]} == {"ENG": False, "ITA": True}
