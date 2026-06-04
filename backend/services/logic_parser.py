from __future__ import annotations
import re
from typing import Any
from pyparsing import (
    Word, alphanums, oneOf, Literal, CaselessKeyword, Combine,
    Forward, infixNotation, opAssoc, ParserElement, ParseException
)

ParserElement.enablePackrat()

def build_parser():
    """
    Parser per espressioni booleane su token tri-stato:
      +P  => P vale '+'
      -P  => P vale '-'
      0P  => P vale '0'
    Vincolo: NESSUNO spazio tra segno e parametro (qualsiasi spazio, anche Unicode).
    Operatori: & |  e  AND OR NOT (case-insensitive).  Precedenza: NOT > AND > OR.
    """
    sign = oneOf("+ - 0")
    param = Word(alphanums + "_")

    # Operando: un token unico senza spazi fra segno e parametro
    # (Combine impedisce qualunque whitespace in mezzo, incl. NBSP)
    operand = Combine(sign + param).setParseAction(
        lambda t: (t[0][0], t[0][1:].upper())  # ('+FGM' -> ('+','FGM'))
    )

    expr = Forward()
    NOT = CaselessKeyword("not")
    AND = (Literal("&") | CaselessKeyword("and"))
    OR  = (Literal("|") | CaselessKeyword("or"))

    expr <<= infixNotation(
        operand,
        [
            (NOT, 1, opAssoc.RIGHT),
            (AND, 2, opAssoc.LEFT),
            (OR,  2, opAssoc.LEFT),
        ]
    )
    return expr


# ----------------------------------------------------------------------------
# Rinomina di un parametro DENTRO le formule (implicational_condition).
#
# A differenza di lingue/question, l'id di un parametro compare come testo negli
# operandi delle formule di altri parametri (`+P1`, `-FGM`, `0P3`). Quando un id
# viene rinominato bisogna riscrivere quelle formule. Lo facciamo con una regex
# TOKEN-AWARE (non un replace di stringa): un operando è `sign + param` senza
# spazi, con sign ∈ {+,-,0} e param = [A-Za-z0-9_]+ (coerente con build_parser).
# Confrontando la PAROLA INTERA evitiamo di toccare i parametri di cui old_id è
# solo prefisso/sottostringa (rinominando 'P1' NON cambiamo '+P12' né '+P1A').
# Il lookbehind impedisce di interpretare come "segno" uno 0 interno a una parola.
# ----------------------------------------------------------------------------
_OPERAND_RE = re.compile(r'(?<![A-Za-z0-9_])([+\-0])([A-Za-z0-9_]+)')


def rename_param_in_expression(expr: str | None, old_id: str, new_id: str) -> str:
    """Sostituisce ogni operando che cita `old_id` con `new_id`, preservando
    segno, operatori, parentesi e spaziatura. Case-insensitive sul nome del
    parametro (il parser uppercasa in valutazione). Ritorna la formula invariata
    se `expr` è vuota o `old_id == new_id`.
    """
    if not expr or old_id == new_id:
        return expr or ""
    old_up = old_id.upper()

    def _repl(m: "re.Match") -> str:
        sign, word = m.group(1), m.group(2)
        if word.upper() == old_up:
            return f"{sign}{new_id}"
        return m.group(0)

    return _OPERAND_RE.sub(_repl, expr)


def _as_list(node: Any):
    if isinstance(node, tuple):
        return node
    try:
        return list(node)
    except TypeError:
        return node

def eval_node(node, values: dict[str, str]) -> bool:
    # Token foglia: ('+', 'FGM') ecc.
    if isinstance(node, tuple):
        sign, param = node
        return values.get(param) == sign

    node = _as_list(node)

    # NOT <expr>
    if isinstance(node, list) and len(node) == 2 and str(node[0]).lower() == 'not':
        return not eval_node(node[1], values)

    # Catene di AND/OR: [A, op, B, op, C, ...]
    if isinstance(node, list) and len(node) >= 3 and len(node) % 2 == 1:
        result = eval_node(node[0], values)
        i = 1
        while i < len(node):
            op = str(node[i]).lower()
            right = eval_node(node[i + 1], values)
            if op in ('&', 'and'):
                result = result and right
            elif op in ('|', 'or'):
                result = result or right
            else:
                raise ValueError(f"Operatore non gestito: {op}")
            i += 2
        return result

    # Caso binario classico <left> op <right>
    if isinstance(node, list) and len(node) == 3:
        left, op, right = node
        op_str = str(op).lower()
        if op_str in ('&', 'and'):
            return eval_node(left, values) and eval_node(right, values)
        if op_str in ('|', 'or'):
            return eval_node(left, values) or eval_node(right, values)

    raise ValueError(f"Nodo non gestito: {node}")


def evaluate_with_parser(expression: str, values: dict[str, str]) -> bool:
    """
    True se l'espressione è soddisfatta dai valori correnti.
    Robustezza: qualsiasi errore/parse vuoto -> False.
    """
    expr = (expression or "").strip()
    if not expr:
        return True  

    parser = build_parser()
    try:
        res = parser.parseString(expr, parseAll=True)
        if len(res) == 0:
            return False
        root = _as_list(res[0])
        return eval_node(root, values)
    except Exception:
        return False


# ---------- UTIL per validazione e preview umana ----------

def validate_expression(expression: str) -> None:
    """
    Valida l'espressione. Regole:
      - Nessuno spazio fra segno e parametro (es. '- FGK' o '-\u00A0FGK' = ERRORE).
      - Solo token ammessi (+P, -P, 0P) e operatori (&, |, AND/OR/NOT).
    Solleva ParseException in caso di invalidità.
    """
    parser = build_parser()
    parser.parseString((expression or ""), parseAll=True)


def pretty_print_expression(expression: str) -> str:
    """
    Rende forma human-readable:
      +FGM | +FGA    ->  (FGM=+ OR FGA=+)
      ... & -FGK     ->  ... AND FGK=-
      not +FGM       ->  NOT (FGM=+)
    Espressione vuota/None -> stringa vuota (parametri senza condizione).
    """
    expr = (expression or "").strip()
    if not expr:
        return ""
    parser = build_parser()
    try:
        res = parser.parseString(expr, parseAll=True)
        if len(res) == 0:
            raise ParseException("empty parse")
        root = _as_list(res[0])
    except Exception as e:
        raise ParseException(str(e))

    def render(n) -> str:
        if isinstance(n, tuple):
            s, p = n
            return f"{p}={s}"

        n = _as_list(n)

        # NOT <expr>
        if isinstance(n, list) and len(n) == 2 and str(n[0]).lower() == 'not':
            return f"NOT ({render(n[1])})"

        # Catene di AND/OR: [A, op, B, op, C, ...]
        if isinstance(n, list) and len(n) >= 3 and len(n) % 2 == 1:
            parts = []
            parts.append(render(n[0]))
            i = 1
            while i < len(n):
                op_str = str(n[i]).lower()
                op_txt = 'AND' if op_str in ('&', 'and') else ('OR' if op_str in ('|', 'or') else '?')
                parts.append(op_txt)
                parts.append(render(n[i + 1]))
                i += 2
            return "(" + " ".join(parts) + ")"

        # Caso binario classico
        if isinstance(n, list) and len(n) == 3:
            left, op, right = n
            op_str = str(op).lower()
            op_txt = 'AND' if op_str in ('&', 'and') else ('OR' if op_str in ('|', 'or') else '?')
            return f"({render(left)} {op_txt} {render(right)})"

        raise ValueError(f"Nodo non gestito in render: {n}")

    return render(root)

def trace_evaluation_tree(node, values: dict[str, str]) -> dict:
    """
    NUOVA FUNZIONE: Genera un albero JSON strutturato per il diagramma grafico in React.
    Sostituisce il vecchio print_circuit_diagram in ASCII-art.
    """
    if isinstance(node, tuple):
        sign, param = node
        actual_val = values.get(param)
        res = (actual_val == sign)
        return {
            "type": "LEAF", "label": f"{sign}{param}",
            "actual_value": actual_val or "None", "result": res, "children": []
        }

    node = _as_list(node)

    # NOT <expr>
    if isinstance(node, list) and len(node) == 2 and str(node[0]).lower() == 'not':
        child_trace = trace_evaluation_tree(node[1], values)
        res = not child_trace["result"]
        return {"type": "NOT", "label": "NOT", "result": res, "children": [child_trace]}

    # Catene di AND/OR: [A, op, B, op, C, ...]
    if isinstance(node, list) and len(node) >= 3 and len(node) % 2 == 1:
        op_str = str(node[1]).lower()
        op_txt = 'AND' if op_str in ('&', 'and') else 'OR'

        children_traces = [trace_evaluation_tree(node[i], values) for i in range(0, len(node), 2)]

        if op_txt == 'AND':
            res = all(c["result"] for c in children_traces)
        else:
            res = any(c["result"] for c in children_traces)

        return {"type": "OPERATOR", "label": op_txt, "result": res, "children": children_traces}

    # Caso binario classico (esattamente come nel tuo eval_node)
    if isinstance(node, list) and len(node) == 3:
        left, op, right = node
        op_str = str(op).lower()
        op_txt = 'AND' if op_str in ('&', 'and') else 'OR'

        left_trace = trace_evaluation_tree(left, values)
        right_trace = trace_evaluation_tree(right, values)

        if op_txt == 'AND':
            res = left_trace["result"] and right_trace["result"]
        else:
            res = left_trace["result"] or right_trace["result"]

        return {"type": "OPERATOR", "label": op_txt, "result": res, "children": [left_trace, right_trace]}

    return {"type": "ERROR", "label": "Unknown", "result": False, "children": []}