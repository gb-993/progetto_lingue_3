"""Test della copia "solo esempi" tra question (services/question_transfer).

Comportamento atteso (richiesta linguisti 2026-06):
  - gli esempi della sorgente vengono DUPLICATI sulle risposte della
    destinazione, lingua per lingua; risposta/motivazioni/testi intatti
  - la sorgente non viene toccata (e' una copia, non uno spostamento)
  - lingue senza risposta in destinazione -> saltate e riportate
  - idempotente: rilanciare la copia non crea doppioni
  - la numerazione degli esempi copiati prosegue quella esistente
  - nessuna marcatura di provenienza sugli esempi copiati
"""
import models
from services.question_transfer import (
    copy_examples_only,
    preview_examples_copy,
)


def _seed(db):
    db.add(models.ParameterDef(id="PSC", position=1, name="Param", is_active=True))
    db.flush()
    db.add_all([
        models.Question(id="PSC_Qa", parameter_id="PSC", text="dest?", is_stop_question=False, is_active=True),
        models.Question(id="PSC_Qb", parameter_id="PSC", text="source?", is_stop_question=False, is_active=True),
    ])
    db.add_all([
        models.Language(id="ita", name_full="Italian", position=1),
        models.Language(id="fra", name_full="French", position=2),
        models.Language(id="deu", name_full="German", position=3),
    ])
    db.commit()


def _answer(db, lang, qid, resp="yes"):
    a = models.Answer(language_id=lang, question_id=qid, response_text=resp)
    db.add(a)
    db.flush()
    return a


def _example(db, answer, number, text, reference="ref"):
    e = models.Example(
        answer_id=answer.id, number=number, textarea=text,
        gloss=f"gloss {text}", translation=f"tr {text}", reference=reference,
    )
    db.add(e)
    db.flush()
    return e


def test_copy_appends_examples_and_leaves_source_untouched(db_session):
    _seed(db_session)
    # ita: sorgente con 2 esempi, destinazione con 1 esempio gia' suo
    src_a = _answer(db_session, "ita", "PSC_Qb", "no")
    _example(db_session, src_a, "1", "src uno")
    _example(db_session, src_a, "2", "src due")
    dst_a = _answer(db_session, "ita", "PSC_Qa", "yes")
    _example(db_session, dst_a, "1", "dest uno")
    db_session.commit()

    result = copy_examples_only(db_session, "PSC_Qb", "PSC_Qa")
    db_session.commit()

    assert result["examples_copied"] == 2
    assert result["languages_processed"] == 1
    assert result["languages_skipped"] == []

    # Destinazione: 1 esempio originale + 2 copiati, numerati a seguire (2, 3)
    dest_examples = sorted(dst_a.examples, key=lambda e: int(e.number))
    assert [e.textarea for e in dest_examples] == ["dest uno", "src uno", "src due"]
    assert [e.number for e in dest_examples] == ["1", "2", "3"]

    # Nessuna marcatura di provenienza (richiesta esplicita): i campi sono
    # copiati identici alla sorgente.
    assert all("PSC_Qb" not in (e.reference or "") for e in dest_examples)

    # Sorgente intatta: risposta e i suoi 2 esempi ancora li'.
    src_after = (
        db_session.query(models.Answer)
        .filter_by(language_id="ita", question_id="PSC_Qb").one()
    )
    assert src_after.response_text == "no"
    assert len(src_after.examples) == 2


def test_copy_is_idempotent(db_session):
    _seed(db_session)
    src_a = _answer(db_session, "ita", "PSC_Qb")
    _example(db_session, src_a, "1", "solo questo")
    _answer(db_session, "ita", "PSC_Qa")
    db_session.commit()

    r1 = copy_examples_only(db_session, "PSC_Qb", "PSC_Qa")
    db_session.commit()
    r2 = copy_examples_only(db_session, "PSC_Qb", "PSC_Qa")
    db_session.commit()

    assert r1["examples_copied"] == 1
    assert r2["examples_copied"] == 0
    assert r2["duplicates_skipped"] == 1
    dst = (
        db_session.query(models.Answer)
        .filter_by(language_id="ita", question_id="PSC_Qa").one()
    )
    assert len(dst.examples) == 1


def test_languages_without_dest_answer_are_skipped(db_session):
    _seed(db_session)
    # fra: la sorgente ha esempi ma la destinazione NON ha risposta
    src_fra = _answer(db_session, "fra", "PSC_Qb")
    _example(db_session, src_fra, "1", "fra uno")
    # deu: copiabile normalmente
    src_deu = _answer(db_session, "deu", "PSC_Qb")
    _example(db_session, src_deu, "1", "deu uno")
    _answer(db_session, "deu", "PSC_Qa")
    db_session.commit()

    result = copy_examples_only(db_session, "PSC_Qb", "PSC_Qa")
    db_session.commit()

    assert result["languages_skipped"] == ["fra"]
    assert result["examples_copied"] == 1
    # fra non deve avere risposte fantasma create in destinazione
    assert (
        db_session.query(models.Answer)
        .filter_by(language_id="fra", question_id="PSC_Qa").first()
    ) is None


def test_preview_matches_copy(db_session):
    _seed(db_session)
    src_ita = _answer(db_session, "ita", "PSC_Qb")
    _example(db_session, src_ita, "1", "ita uno")
    _example(db_session, src_ita, "2", "ita dup")
    dst_ita = _answer(db_session, "ita", "PSC_Qa")
    # duplicato gia' presente in destinazione (stesso contenuto di "ita dup")
    _example(db_session, dst_ita, "1", "ita dup")
    src_fra = _answer(db_session, "fra", "PSC_Qb")
    _example(db_session, src_fra, "1", "fra uno")
    db_session.commit()

    p = preview_examples_copy(db_session, "PSC_Qb", "PSC_Qa")
    assert p["copyable_examples_total"] == 1      # "ita uno"
    assert p["duplicates_total"] == 1             # "ita dup"
    assert [s["language_id"] for s in p["skipped"]] == ["fra"]

    result = copy_examples_only(db_session, "PSC_Qb", "PSC_Qa")
    assert result["examples_copied"] == p["copyable_examples_total"]
    assert result["duplicates_skipped"] == p["duplicates_total"]
    assert result["languages_skipped"] == ["fra"]
