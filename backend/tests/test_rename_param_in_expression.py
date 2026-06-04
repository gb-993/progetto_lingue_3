"""Test ESTENSIVI di rename_param_in_expression — riscrittura token-aware dei
riferimenti a un parametro dentro le formule (implicational_condition).

È la parte centrale del rename parametri: una sostituzione sbagliata
corromperebbe la logica del sito. Copriamo: segni +/-/0, sottostringhe,
operatori &|/and/or/not, parentesi, case, underscore, occorrenze multiple, e
l'EQUIVALENZA SEMANTICA (la formula riscritta valuta come l'originale).
"""
import pytest

from services.logic_parser import (
    rename_param_in_expression as rn,
    build_parser,
    eval_node,
    validate_expression,
)


# ---------------------------------------------------------------------------
# Base / no-op
# ---------------------------------------------------------------------------

def test_empty_and_none():
    assert rn("", "P1", "PX") == ""
    assert rn(None, "P1", "PX") == ""


def test_same_id_is_noop():
    assert rn("+P1 & -P2", "P1", "P1") == "+P1 & -P2"


def test_no_match_unchanged():
    assert rn("+P2 | -P3", "P1", "PX") == "+P2 | -P3"


# ---------------------------------------------------------------------------
# Segni preservati
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("sign", ["+", "-", "0"])
def test_preserves_sign(sign):
    assert rn(f"{sign}P1", "P1", "PX") == f"{sign}PX"


def test_replaces_all_occurrences():
    assert rn("+P1 & -P1 | 0P1", "P1", "PX") == "+PX & -PX | 0PX"


# ---------------------------------------------------------------------------
# Sicurezza sulle SOTTOSTRINGHE — il punto critico
# ---------------------------------------------------------------------------

def test_does_not_touch_longer_ids():
    # Rinominando P1 NON devono cambiare P12, P1A, P10
    assert rn("+P12", "P1", "PX") == "+P12"
    assert rn("+P1A", "P1", "PX") == "+P1A"
    assert rn("+P10 & +P1", "P1", "PX") == "+P10 & +PX"


def test_does_not_touch_prefixed_ids():
    assert rn("+AP1 & +P1", "P1", "PX") == "+AP1 & +PX"


def test_rename_longer_id_leaves_shorter_alone():
    # Rinominando P10 NON deve cambiare P1 né P100
    assert rn("+P1 & +P10 | +P100", "P10", "PZ") == "+P1 & +PZ | +P100"


# ---------------------------------------------------------------------------
# Operatori, parentesi, NOT, spaziatura
# ---------------------------------------------------------------------------

def test_keeps_operators_and_spacing():
    assert rn("+P1 and not -P3", "P1", "PA") == "+PA and not -P3"
    assert rn("+P1&+P2|-P3", "P2", "PZ") == "+P1&+PZ|-P3"


def test_parentheses_preserved():
    assert rn("(+P1 | +P2) & -P3", "P3", "PQ") == "(+P1 | +P2) & -PQ"


def test_no_space_before_operator():
    assert rn("+P1&+P2", "P1", "PX") == "+PX&+P2"


def test_does_not_match_operator_words():
    # 'and'/'or'/'not' non hanno segno: non devono mai essere toccati
    assert rn("+P1 and +P2", "and", "XXX") == "+P1 and +P2"


# ---------------------------------------------------------------------------
# Case-insensitive + underscore
# ---------------------------------------------------------------------------

def test_case_insensitive_match():
    assert rn("+p1 & -P1", "P1", "PX") == "+PX & -PX"


def test_underscore_ids():
    assert rn("+P_1", "P_1", "Q") == "+Q"
    assert rn("+P_12 & +P_1", "P_1", "Q") == "+P_12 & +Q"


# ---------------------------------------------------------------------------
# EQUIVALENZA SEMANTICA: la formula riscritta valuta esattamente come
# l'originale (con l'id sostituito nei valori). Questo prova che il rename
# non cambia la logica.
# ---------------------------------------------------------------------------

def _eval(expr: str, values: dict) -> bool:
    parsed = build_parser().parseString(expr, parseAll=True)
    return eval_node(parsed[0], values)


@pytest.mark.parametrize("expr", [
    "+P1",
    "-P1",
    "+P1 & -P2",
    "+P1 | +P2",
    "+P1 & not -P2",
    "(+P1 | +P2) & -P3",
    "+P10 & +P1",
])
def test_semantic_equivalence_after_rename(expr):
    new_expr = rn(expr, "P1", "PX")
    # la formula riscritta deve restare valida sintatticamente
    validate_expression(new_expr)
    # Per ogni combinazione di valori, l'esito non cambia se rimappo P1 -> PX.
    signs = ["+", "-", "0"]
    import itertools
    for combo in itertools.product(signs, repeat=4):
        v_old = {"P1": combo[0], "P2": combo[1], "P3": combo[2], "P10": combo[3]}
        v_new = {"PX": combo[0], "P2": combo[1], "P3": combo[2], "P10": combo[3]}
        assert _eval(expr, v_old) == _eval(new_expr, v_new), (expr, new_expr, combo)
