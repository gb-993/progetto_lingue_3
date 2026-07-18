"""
Script computazionali di TableA sulla vista Questions.

Trasposizione concordata con C. Guardiano (email, giugno 2026):
  - yes → '+', no → '-'
  - unsure / missing / vuoto → missing character ('0'), quindi saltati da
    _hamming_core/_jaccard_core esattamente come gli 0/?/vuoto dei parametri
  - ogni question è un item indipendente: nessuna ri-pesatura per parametro
    (un parametro con più domande pesa di più — comportamento voluto).

I test chiamano le funzioni endpoint direttamente col db_session del conftest
(stesso stile degli altri test del repo, niente TestClient); i corpi delle
StreamingResponse vengono drenati con un piccolo helper asyncio.

Dati seminati (3 lingue con coordinate, 1 parametro, 4 domande attive):

            P1_01   P1_02   P1_03    P1_04
    AAA     yes     yes     no       missing
    BBB     yes     no      unsure   yes
    CCC     no      no      yes      (nessuna riga Answer)

Simboli attesi (yes→+, no→-, resto→0):
    AAA: [+, +, -, 0]
    BBB: [+, -, 0, +]
    CCC: [-, -, +, 0]

Distanze attese (calcolate a mano, coppie senza confronto saltate):
    hamming : AAA-BBB 0.5   AAA-CCC 1.0   BBB-CCC 0.5
    jaccard+: AAA-BBB 0.5   AAA-CCC 1.0   BBB-CCC 1.0
"""
import asyncio
import io
import zipfile

import pytest

import models
from routers.tablea import (
    TableAFilterRequest,
    MantelRequest,
    ClusterMapRequest,
    _get_filtered_data,
    _get_symbol_data,
    _orphan_answers_report,
    get_tablea_matrix,
    export_distances_txt,
    export_geo_distances_zip,
    export_dendrograms_png,
    export_cluster_map_html,
    export_pca_png,
    export_mantel_zip,
)
from services.param_consolidate import recompute_and_persist_language_parameter
from services.dag_eval import run_dag_for_language

PNG_MAGIC = b"\x89PNG"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _read_body(resp) -> bytes:
    """Estrae i bytes da una Response/StreamingResponse di FastAPI."""
    if hasattr(resp, "body_iterator"):
        async def _drain():
            return b"".join([chunk async for chunk in resp.body_iterator])
        return asyncio.run(_drain())
    return bytes(resp.body)


def _parse_dist_txt(text: str):
    """Parsa un TSV di distanze (ignora le righe-commento '#' della citazione).

    Ritorna un dict {(id_riga, id_colonna): float}.
    """
    lines = [ln for ln in text.splitlines() if ln.strip() and not ln.startswith("#")]
    header = lines[0].split("\t")[1:]
    mat = {}
    for ln in lines[1:]:
        parts = ln.split("\t")
        for col, val in zip(header, parts[1:]):
            mat[(parts[0], col)] = float(val)
    return mat


def _seed_questions(db):
    """3 lingue con coordinate + 1 parametro con 4 domande (vedi docstring modulo)."""
    db.add_all([
        models.Language(id="AAA", name_full="Lang A", position=1, latitude=41.9, longitude=12.5),
        models.Language(id="BBB", name_full="Lang B", position=2, latitude=48.85, longitude=2.35),
        models.Language(id="CCC", name_full="Lang C", position=3, latitude=52.52, longitude=13.4),
    ])
    db.add(models.ParameterDef(id="P1", position=1, name="Param One", is_active=True))
    for qid in ("P1_01", "P1_02", "P1_03", "P1_04"):
        db.add(models.Question(id=qid, parameter_id="P1", text=f"Question {qid}?",
                               is_stop_question=False, is_active=True))
    answers = {
        ("AAA", "P1_01"): "yes", ("AAA", "P1_02"): "yes", ("AAA", "P1_03"): "no", ("AAA", "P1_04"): "missing",
        ("BBB", "P1_01"): "yes", ("BBB", "P1_02"): "no",  ("BBB", "P1_03"): "unsure", ("BBB", "P1_04"): "yes",
        ("CCC", "P1_01"): "no",  ("CCC", "P1_02"): "no",  ("CCC", "P1_03"): "yes",
    }
    for (lid, qid), resp in answers.items():
        db.add(models.Answer(language_id=lid, question_id=qid,
                             response_text=resp, status="approved"))
    db.commit()


EXPECTED_HAMMING_Q = {
    ("AAA", "BBB"): 0.5, ("AAA", "CCC"): 1.0, ("BBB", "CCC"): 0.5,
}
EXPECTED_JACCARD_Q = {
    ("AAA", "BBB"): 0.5, ("AAA", "CCC"): 1.0, ("BBB", "CCC"): 1.0,
}


def _assert_matrix(mat, expected):
    for (a, b), d in expected.items():
        assert mat[(a, b)] == pytest.approx(d), f"{a}-{b}"
        assert mat[(b, a)] == pytest.approx(d), f"{b}-{a} (simmetria)"
    for lid in ("AAA", "BBB", "CCC"):
        assert mat[(lid, lid)] == pytest.approx(0.0), f"diagonale {lid}"


# ---------------------------------------------------------------------------
# Mappatura risposte → simboli
# ---------------------------------------------------------------------------

def test_symbol_mapping_questions_view(db_session):
    """yes→+, no→-, unsure/missing/assente→0, nell'ordine giusto."""
    _seed_questions(db_session)
    langs, rows = _get_symbol_data(db_session, TableAFilterRequest(view="questions"))
    assert [l.id for l in langs] == ["AAA", "BBB", "CCC"]
    assert [r["id"] for r in rows] == ["P1_01", "P1_02", "P1_03", "P1_04"]
    cells = {r["id"]: r["cells"] for r in rows}
    assert cells["P1_01"] == ["+", "+", "-"]
    assert cells["P1_02"] == ["+", "-", "-"]
    assert cells["P1_03"] == ["-", "0", "+"]   # unsure → 0
    assert cells["P1_04"] == ["0", "+", "0"]   # missing → 0, nessuna Answer → 0


def test_symbol_data_params_view_unchanged(db_session):
    """In vista params _get_symbol_data non deve toccare le celle."""
    _seed_questions(db_session)
    lp = models.LanguageParameter(language_id="AAA", parameter_id="P1", value_orig="+")
    db_session.add(lp); db_session.flush()
    db_session.add(models.LanguageParameterEval(language_parameter_id=lp.id, value_eval="+"))
    db_session.commit()

    filters = TableAFilterRequest(view="params")
    langs_a, rows_a = _get_filtered_data(db_session, filters)
    langs_b, rows_b = _get_symbol_data(db_session, filters)
    assert [l.id for l in langs_a] == [l.id for l in langs_b]
    assert rows_a == rows_b


# ---------------------------------------------------------------------------
# Distances (.txt zip)
# ---------------------------------------------------------------------------

def test_distances_questions_view(db_session):
    _seed_questions(db_session)
    resp = export_distances_txt(TableAFilterRequest(view="questions"), db_session)
    assert "distances_txt_questions.zip" in resp.headers["content-disposition"]

    with zipfile.ZipFile(io.BytesIO(_read_body(resp))) as zf:
        assert sorted(zf.namelist()) == ["hamming.txt", "jaccard[+].txt"]
        _assert_matrix(_parse_dist_txt(zf.read("hamming.txt").decode()), EXPECTED_HAMMING_Q)
        _assert_matrix(_parse_dist_txt(zf.read("jaccard[+].txt").decode()), EXPECTED_JACCARD_Q)


def test_distances_params_view_regression(db_session):
    """La vista params continua a usare value_eval, senza alcuna mappatura.

    Eval seminati: P1 → AAA '+', BBB '-', CCC '+'; P2 → AAA '+', BBB '+', CCC '?'.
    hamming: AAA-BBB 0.5 | AAA-CCC 0.0 ('?' saltato) | BBB-CCC 1.0
    """
    db_session.add_all([
        models.Language(id="AAA", name_full="Lang A", position=1),
        models.Language(id="BBB", name_full="Lang B", position=2),
        models.Language(id="CCC", name_full="Lang C", position=3),
    ])
    db_session.add_all([
        models.ParameterDef(id="P1", position=1, name="One", is_active=True),
        models.ParameterDef(id="P2", position=2, name="Two", is_active=True),
    ])
    evals = {("AAA", "P1"): "+", ("BBB", "P1"): "-", ("CCC", "P1"): "+",
             ("AAA", "P2"): "+", ("BBB", "P2"): "+", ("CCC", "P2"): "?"}
    for (lid, pid), val in evals.items():
        lp = models.LanguageParameter(language_id=lid, parameter_id=pid, value_orig=val)
        db_session.add(lp); db_session.flush()
        db_session.add(models.LanguageParameterEval(language_parameter_id=lp.id, value_eval=val))
    db_session.commit()

    resp = export_distances_txt(TableAFilterRequest(view="params"), db_session)
    assert "distances_txt_params.zip" in resp.headers["content-disposition"]
    with zipfile.ZipFile(io.BytesIO(_read_body(resp))) as zf:
        mat = _parse_dist_txt(zf.read("hamming.txt").decode())
    _assert_matrix(mat, {("AAA", "BBB"): 0.5, ("AAA", "CCC"): 0.0, ("BBB", "CCC"): 1.0})


# ---------------------------------------------------------------------------
# Geographic distances (indipendenti dalla vista)
# ---------------------------------------------------------------------------

def test_geo_distances_questions_view(db_session):
    _seed_questions(db_session)
    resp = export_geo_distances_zip(TableAFilterRequest(view="questions"), db_session)
    with zipfile.ZipFile(io.BytesIO(_read_body(resp))) as zf:
        assert sorted(zf.namelist()) == ["crow_flies_km.txt", "gcd_km.txt"]
        mat = _parse_dist_txt(zf.read("gcd_km.txt").decode())
    # Roma-Parigi ~1105 km in great-circle: sanity check, non porting test.
    assert mat[("AAA", "BBB")] == pytest.approx(1105, abs=15)
    assert mat[("AAA", "AAA")] == 0.0


# ---------------------------------------------------------------------------
# Dendrograms / PCA / Cluster map
# ---------------------------------------------------------------------------

def test_dendrograms_questions_view(db_session):
    _seed_questions(db_session)
    resp = export_dendrograms_png(TableAFilterRequest(view="questions"), db_session)
    assert "dendrograms_questions.zip" in resp.headers["content-disposition"]
    with zipfile.ZipFile(io.BytesIO(_read_body(resp))) as zf:
        assert sorted(zf.namelist()) == [
            "dendrogram_hamming_average.png",
            "dendrogram_jaccard[+]_average.png",
        ]
        for name in zf.namelist():
            assert zf.read(name).startswith(PNG_MAGIC)


def test_pca_questions_view(db_session):
    _seed_questions(db_session)
    resp = export_pca_png(TableAFilterRequest(view="questions"), db_session)
    assert "pca_scatterplot_questions.png" in resp.headers["content-disposition"]
    assert _read_body(resp).startswith(PNG_MAGIC)


def test_cluster_map_questions_view(db_session):
    _seed_questions(db_session)
    resp = export_cluster_map_html(ClusterMapRequest(view="questions"), db_session)
    assert "cluster_map_questions.html" in resp.headers["content-disposition"]
    body = _read_body(resp)
    assert b"plotly" in body


# ---------------------------------------------------------------------------
# Mantel test
# ---------------------------------------------------------------------------

def test_mantel_questions_view(db_session):
    _seed_questions(db_session)
    resp = export_mantel_zip(MantelRequest(view="questions"), db_session)
    assert "mantel_test_questions.zip" in resp.headers["content-disposition"]

    with zipfile.ZipFile(io.BytesIO(_read_body(resp))) as zf:
        names = set(zf.namelist())
        assert {"gcd.txt", "hamming.txt", "jaccard[+].txt", "mantel_results.csv"} <= names
        # Le matrici dentro il Mantel devono coincidere con l'export distances.
        _assert_matrix(_parse_dist_txt(zf.read("hamming.txt").decode()), EXPECTED_HAMMING_Q)
        _assert_matrix(_parse_dist_txt(zf.read("jaccard[+].txt").decode()), EXPECTED_JACCARD_Q)
        # 3 coppie di matrici → 3 scatterplot png + 3 html.
        assert sum(n.endswith("_mantel_scatterplot.png") for n in names) == 3
        assert sum(n.endswith("_mantel_scatterplot_interactive.html") for n in names) == 3
        results = zf.read("mantel_results.csv").decode()
    # 3 coppie × 3 metodi = 9 righe risultato (+ header, + citazione '#').
    data_lines = [ln for ln in results.splitlines() if ln.strip() and not ln.startswith("#")]
    assert len(data_lines) == 1 + 9


# ---------------------------------------------------------------------------
# Risposte su parametri azzerati dall'implicazione (warning UI)
# ---------------------------------------------------------------------------

def _seed_implication(db):
    """P1 senza condizione, P2 con condizione '+P1' (1 domanda ciascuno).

        AAA: P1 no  -> P1 '-' -> P2 azzerato,  ma ha risposto 'no' a P2  -> ORFANA
        BBB: P1 yes -> P1 '+' -> P2 attivo,    ha risposto 'yes' a P2    -> regolare
        CCC: P1 no  -> P1 '-' -> P2 azzerato,  nessuna risposta su P2    -> nulla
    """
    db.add_all([
        models.Language(id="AAA", name_full="Lang A", position=1),
        models.Language(id="BBB", name_full="Lang B", position=2),
        models.Language(id="CCC", name_full="Lang C", position=3),
    ])
    db.add_all([
        models.ParameterDef(id="P1", position=1, name="Parent", is_active=True),
        models.ParameterDef(id="P2", position=2, name="Child", is_active=True,
                            implicational_condition="+P1"),
    ])
    db.add_all([
        models.Question(id="P1_01", parameter_id="P1", text="P1?",
                        is_stop_question=False, is_active=True),
        models.Question(id="P2_01", parameter_id="P2", text="P2?",
                        is_stop_question=False, is_active=True),
    ])
    for lid, q, resp in [("AAA", "P1_01", "no"), ("AAA", "P2_01", "no"),
                         ("BBB", "P1_01", "yes"), ("BBB", "P2_01", "yes"),
                         ("CCC", "P1_01", "no")]:
        db.add(models.Answer(language_id=lid, question_id=q,
                             response_text=resp, status="approved"))
    db.commit()

    for lid in ("AAA", "BBB", "CCC"):
        for pid in ("P1", "P2"):
            recompute_and_persist_language_parameter(lid, pid, db)
    db.commit()
    for lid in ("AAA", "BBB", "CCC"):
        run_dag_for_language(lid, db)
    db.commit()


def test_orphan_answers_detected(db_session):
    """Solo AAA ha risposto a un parametro che l'implicazione azzera."""
    _seed_implication(db_session)
    # Precondizione: P2 di AAA e' davvero '0', quello di BBB no.
    _, rows = _get_symbol_data(db_session, TableAFilterRequest(view="params"))
    p2 = next(r for r in rows if r["id"] == "P2")
    assert p2["cells"] == ["0", "+", "0"]

    rep = _orphan_answers_report(db_session, ["AAA", "BBB", "CCC"], ["P1_01", "P2_01"])
    assert rep["count"] == 1
    assert rep["languages"] == ["AAA"]
    assert rep["parameters"] == ["P2"]


def test_orphan_answers_exposed_only_in_questions_view(db_session):
    """/matrix riporta il conteggio in vista questions, mai in vista params."""
    _seed_implication(db_session)

    q = get_tablea_matrix(TableAFilterRequest(view="questions"), db_session)
    assert q["orphan_answers"]["count"] == 1
    assert q["orphan_answers"]["languages"] == ["AAA"]

    p = get_tablea_matrix(TableAFilterRequest(view="params"), db_session)
    assert p["orphan_answers"] == {"count": 0, "languages": [], "parameters": []}


def test_orphan_answers_none_when_no_implication(db_session):
    """Dataset senza condizioni implicazionali: nessuna risposta orfana."""
    _seed_questions(db_session)
    res = get_tablea_matrix(TableAFilterRequest(view="questions"), db_session)
    assert res["orphan_answers"]["count"] == 0
