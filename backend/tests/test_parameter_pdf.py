"""PDF dei parametri: le domande disattivate non compaiono."""
import models
import routers.parameters as parameters_router
from routers.parameters import ParametersInfoPdfPayload, download_parameter_pdf, export_parameters_info_pdf


def _seed(db):
    admin = models.User(id=1, email="a@b.it", hashed_password="x", name="A", surname="B", role="admin")
    db.add(admin)
    db.add(models.ParameterDef(id="P1", name="P1", position=1, is_active=True))
    db.add_all([
        models.Question(id="P1_Qa", parameter_id="P1", text="active", is_active=True),
        models.Question(id="P1_Qb", parameter_id="P1", text="deactivated", is_active=False),
        models.Question(id="P1_QSa", parameter_id="P1", text="stop", is_stop_question=True, is_active=True),
    ])
    db.commit()
    return admin


def test_single_parameter_pdf_skips_deactivated_questions(db_session, monkeypatch):
    admin = _seed(db_session)
    seen = {}
    monkeypatch.setattr(parameters_router, "build_parameter_pdf",
                        lambda parameter, questions: seen.setdefault("ids", [q.id for q in questions]) and b"%PDF-")

    download_parameter_pdf("P1", db=db_session, current_user=admin)

    assert seen["ids"] == ["P1_Qa", "P1_QSa"]


def test_parameters_info_pdf_skips_deactivated_questions(db_session, monkeypatch):
    admin = _seed(db_session)
    seen = {}
    monkeypatch.setattr(parameters_router, "build_all_parameters_pdf",
                        lambda parameters, by_param: seen.setdefault("ids", [q.id for q in by_param["P1"]]) and b"%PDF-")

    export_parameters_info_pdf(ParametersInfoPdfPayload(param_ids=None), db=db_session, current_user=admin)

    assert seen["ids"] == ["P1_Qa", "P1_QSa"]
