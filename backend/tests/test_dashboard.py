"""Test dei conteggi mostrati nelle due dashboard (routers/dashboard)."""
import models
from routers.dashboard import get_admin_dashboard, get_user_dashboard


# ---- dashboard utente: barra di completamento ----

def _seed_user(db):
    """Un utente con una lingua assegnata, due parametri attivi (P1 e P2) e uno spento (P3)."""
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
    # P3 e' disattivato: il totale deve essere 2, non 3, altrimenti il 100%
    # sarebbe irraggiungibile.
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
    # Regressione: il vecchio conteggio sommava le risposte e questa avrebbe
    # gonfiato la percentuale pur non appartenendo a un parametro attivo.
    user = _seed_user(db_session)
    _answer(db_session, "P3_01", "yes")
    lang = _lang(db_session, user)
    assert (lang["complete_params"], lang["progress_pct"]) == (0, 0)


def test_unsure_non_e_un_parametro_completo(db_session):
    # Regressione: il vecchio conteggio trattava 'unsure' come risposta data.
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
    # Il conteggio resta quello reale: l'override e' una dichiarazione, non un calcolo.
    assert lang["complete_params"] == 0


# ---- dashboard admin: parametri rossi ----

def _seed_admin(db):
    """Un admin e una lingua con un solo parametro attivo da due domande."""
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
    # Nessuna risposta = grigio, non rosso: non e' un problema, e' da fare.
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
    # Regressione: il vecchio conteggio vedeva 2 risposte su 2 e non segnalava
    # nulla, pur essendo un parametro senza alcuna risoluzione vera.
    admin = _seed_admin(db_session)
    _answer(db_session, "P1_01", "unsure")
    _answer(db_session, "P1_02", "unsure")
    params = _red_params(db_session, admin)
    assert len(params) == 1
    assert params[0]["reasons"] == ["incomplete (0/2)"]


def test_le_respinte_non_contano_nel_totale_risposto(db_session):
    # Regressione: una risposta respinta gonfiava il conteggio "n/m".
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
