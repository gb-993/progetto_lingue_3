"""Conteggi delle due dashboard (routers/dashboard)."""
import models
from routers.dashboard import get_admin_dashboard, get_user_dashboard


def _seed_user(db):
    """Utente con una lingua, P1 e P2 attivi, P3 spento."""
    user = models.User(email="lin@example.com", hashed_password="x", role="user")
    db.add(user)
    db.flush()

    db.add(models.Language(id="ITA", name_full="Italiano", position=1, assigned_user_id=user.id))
    for param_id, is_active in (("P1", True), ("P2", True), ("P3", False)):
        db.add(models.ParameterDef(id=param_id, position=1, name=param_id, is_active=is_active))
        db.add(models.Question(id=f"{param_id}_01", parameter_id=param_id, text="q", is_active=True))
    db.commit()
    return user


def _answer(db, question_id, response_text, status="pending"):
    db.add(models.Answer(
        language_id="ITA", question_id=question_id,
        response_text=response_text, status=status,
    ))
    db.commit()


def _lang(db, user):
    return get_user_dashboard(db=db, current_user=user)["languages"][0]


def test_parametri_spenti_fuori_dal_totale(db_session):
    # se no il 100% sarebbe irraggiungibile
    user = _seed_user(db_session)
    assert _lang(db_session, user)["total_params"] == 2


def test_lingua_vuota(db_session):
    user = _seed_user(db_session)
    lang = _lang(db_session, user)
    assert (lang["complete_params"], lang["progress_pct"], lang["completion"]) == (0, 0, "empty")


def test_tutti_i_parametri_risolti_danno_cento(db_session):
    user = _seed_user(db_session)
    _answer(db_session, "P1_01", "no")
    _answer(db_session, "P2_01", "no")
    lang = _lang(db_session, user)
    assert (lang["complete_params"], lang["progress_pct"], lang["completion"]) == (2, 100, "complete")


def test_risposta_su_parametro_spento_non_conta(db_session):
    user = _seed_user(db_session)
    _answer(db_session, "P3_01", "yes")
    lang = _lang(db_session, user)
    assert (lang["complete_params"], lang["progress_pct"]) == (0, 0)


def test_unsure_non_e_un_parametro_completo(db_session):
    user = _seed_user(db_session)
    _answer(db_session, "P1_01", "unsure")
    _answer(db_session, "P2_01", "no")
    lang = _lang(db_session, user)
    assert (lang["complete_params"], lang["progress_pct"], lang["completion"]) == (1, 50, "incomplete")


def test_override_del_super_admin_vince_sul_calcolo(db_session):
    user = _seed_user(db_session)
    db_session.query(models.Language).filter_by(id="ITA").one().completion_override = "complete"
    db_session.commit()
    lang = _lang(db_session, user)
    assert lang["completion"] == "complete"
    assert lang["completion_forced"] is True
    # l'override non cambia il conteggio reale
    assert lang["complete_params"] == 0


def _seed_admin(db):
    """Admin e una lingua con un parametro da due domande."""
    admin = models.User(email="admin@example.com", hashed_password="x", role="admin")
    db.add(admin)
    db.add(models.Language(id="ITA", name_full="Italiano", position=1))
    db.add(models.ParameterDef(id="P1", position=1, name="P1", is_active=True))
    db.add(models.Question(id="P1_01", parameter_id="P1", text="q1", is_active=True))
    db.add(models.Question(id="P1_02", parameter_id="P1", text="q2", is_active=True))
    db.commit()
    return admin


def _red_params(db, admin):
    groups = get_admin_dashboard(db=db, current_user=admin)["red_by_language"]
    return groups[0]["params"] if groups else []


def test_parametro_mai_iniziato_non_e_rosso(db_session):
    # nessuna risposta = grigio (da fare), non rosso
    admin = _seed_admin(db_session)
    assert _red_params(db_session, admin) == []


def test_parametro_risolto_non_e_rosso(db_session):
    admin = _seed_admin(db_session)
    _answer(db_session, "P1_01", "no")
    _answer(db_session, "P1_02", "no")
    assert _red_params(db_session, admin) == []


def test_parametro_a_meta_e_rosso(db_session):
    admin = _seed_admin(db_session)
    _answer(db_session, "P1_01", "no")
    params = _red_params(db_session, admin)
    assert len(params) == 1
    assert params[0]["reasons"] == ["incomplete (1/2)"]


def test_tutte_unsure_e_rosso(db_session):
    admin = _seed_admin(db_session)
    _answer(db_session, "P1_01", "unsure")
    _answer(db_session, "P1_02", "unsure")
    params = _red_params(db_session, admin)
    assert len(params) == 1
    assert params[0]["reasons"] == ["incomplete (0/2)"]


def test_le_respinte_non_contano_nel_totale_risposto(db_session):
    admin = _seed_admin(db_session)
    _answer(db_session, "P1_01", "yes", status="rejected")
    params = _red_params(db_session, admin)
    assert len(params) == 1
    assert params[0]["answered"] == 0


def test_flag_unsure_segnala_anche_un_parametro_risolto(db_session):
    admin = _seed_admin(db_session)
    _answer(db_session, "P1_01", "no")
    _answer(db_session, "P1_02", "no")
    db_session.add(models.LanguageParameterStatus(
        language_id="ITA", parameter_id="P1", is_unsure=True,
    ))
    db_session.commit()
    params = _red_params(db_session, admin)
    assert len(params) == 1
    assert params[0]["reasons"] == ["unsure"]
