"""Regressione sul fingerprint di concorrenza ottimistica del blocco parametro.

Bug segnalato dai linguisti: dopo aver DISATTIVATO una Question non si riusciva
piu' a salvare i dati delle altre Question del parametro; ogni salvataggio dava
"le modifiche non potranno essere salvate" (409 stale_block).

Causa: il reader della pagina di compilazione calcola il fingerprint
MAX(answer.updated_at) SOLO sulle question attive, mentre il check di
salvataggio (`_block_last_modified_iso`) lo calcolava su TUTTE le question
(attive + disattivate). Se la question appena disattivata aveva la risposta
piu' recente, restava lei il MAX lato-save: il valore del client non lo
matchava mai -> 409 ad ogni salvataggio.

Fix: `_block_last_modified_iso` filtra `Question.is_active == True`, allineandosi
al reader. Questi test bloccano la regressione.
"""
from datetime import datetime

import models
from routers.compilation import _block_last_modified_iso


def test_fingerprint_ignores_inactive_question_answer(db_session):
    # Parametro con una question attiva e una disattivata (quella che l'admin
    # ha appena messo inactive).
    db_session.add(models.Language(id="ITA", name_full="Italiano", position=1))
    db_session.add(models.ParameterDef(id="P1", position=1, name="P1", is_active=True))
    db_session.add(models.Question(id="P1_01", parameter_id="P1", text="q1", is_active=True))
    db_session.add(models.Question(id="P1_02", parameter_id="P1", text="q2", is_active=False))
    db_session.commit()

    # Risposta della question ATTIVA: aggiornata "prima".
    active_ans = models.Answer(
        language_id="ITA", question_id="P1_01", response_text="no",
        updated_at=datetime(2026, 1, 1, 10, 0, 0),
    )
    # Risposta della question DISATTIVATA: aggiornata "dopo" (l'admin la stava
    # modificando prima di disattivarla). E' lei il MAX globale: senza il filtro
    # is_active il client non potrebbe mai matchare questo timestamp.
    inactive_ans = models.Answer(
        language_id="ITA", question_id="P1_02", response_text="yes",
        updated_at=datetime(2026, 1, 2, 10, 0, 0),
    )
    db_session.add_all([active_ans, inactive_ans])
    db_session.commit()

    fp = _block_last_modified_iso(db_session, "ITA", "P1")

    # Il fingerprint riflette SOLO la question attiva, non la disattivata piu' recente.
    assert fp == active_ans.updated_at.isoformat()
    assert fp != inactive_ans.updated_at.isoformat()


def test_fingerprint_is_max_over_active_questions(db_session):
    # Happy path: con due question attive il fingerprint e' il MAX delle loro
    # risposte (il filtro is_active non deve escludere le attive).
    db_session.add(models.Language(id="ITA", name_full="Italiano", position=1))
    db_session.add(models.ParameterDef(id="P1", position=1, name="P1", is_active=True))
    db_session.add(models.Question(id="P1_01", parameter_id="P1", text="q1", is_active=True))
    db_session.add(models.Question(id="P1_02", parameter_id="P1", text="q2", is_active=True))
    db_session.commit()

    a1 = models.Answer(language_id="ITA", question_id="P1_01", response_text="no",
                       updated_at=datetime(2026, 1, 1, 10, 0, 0))
    a2 = models.Answer(language_id="ITA", question_id="P1_02", response_text="no",
                       updated_at=datetime(2026, 1, 3, 10, 0, 0))
    db_session.add_all([a1, a2])
    db_session.commit()

    fp = _block_last_modified_iso(db_session, "ITA", "P1")
    assert fp == a2.updated_at.isoformat()


def test_fingerprint_none_when_only_inactive_has_answer(db_session):
    # Solo la question disattivata ha una risposta: il blocco attivo e' "vuoto"
    # -> fingerprint None (il client invia expected_last_modified null e il check
    # viene saltato). Senza il filtro, qui tornerebbe erroneamente un timestamp.
    db_session.add(models.Language(id="ITA", name_full="Italiano", position=1))
    db_session.add(models.ParameterDef(id="P1", position=1, name="P1", is_active=True))
    db_session.add(models.Question(id="P1_01", parameter_id="P1", text="q1", is_active=True))
    db_session.add(models.Question(id="P1_02", parameter_id="P1", text="q2", is_active=False))
    db_session.commit()

    db_session.add(models.Answer(
        language_id="ITA", question_id="P1_02", response_text="yes",
        updated_at=datetime(2026, 1, 2, 10, 0, 0),
    ))
    db_session.commit()

    assert _block_last_modified_iso(db_session, "ITA", "P1") is None
