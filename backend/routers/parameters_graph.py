from typing import Dict, List, Optional, Set, Tuple, Iterator, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

import models
from dependencies import get_db, require_admin
from services.logic_parser import (
    build_parser,
    _as_list,
    eval_node,
    trace_evaluation_tree,
)

router = APIRouter(prefix="/api/admin/parameters/graph", tags=["Parameters Graph"])


# ---------------------------------------------------------------------------
# Estrazione antecedenti dall'AST della implicational_condition.
#
# Riusiamo il parser pyparsing definito in services/logic_parser. Il vecchio
# progetto usava una regex che perdeva il segno richiesto (+P uguale a -P) e
# non gestiva 'not'/parentesi. Qui scendiamo l'albero parso e raccogliamo le
# foglie (sign, param_id), mantenendo il segno per disegnarlo sull'edge.
# ---------------------------------------------------------------------------

def _iter_leaves(node: Any, negated: bool = False) -> Iterator[Tuple[str, str, bool]]:
    """Yield (sign, param_id, negated) per ogni foglia.

    `negated` riflette il numero (mod 2) di NOT che racchiudono la foglia
    nell'AST: '+P1' -> negated=False; 'not +P1' -> True; 'not not +P1' -> False.
    Questo serve per disegnare correttamente l'edge con etichetta 'NOT +' e
    per calcolare la soddisfacibilita' dell'edge in modalita' lingua.
    """
    if isinstance(node, tuple) and len(node) == 2 and isinstance(node[0], str) and isinstance(node[1], str):
        yield node[0], node[1], negated
        return
    node = _as_list(node)
    if isinstance(node, list):
        # Pattern NOT: ['not', <sub-espressione>]: invertiamo la polarita' e
        # ricorriamo solo nel figlio.
        if len(node) == 2 and isinstance(node[0], str) and node[0].lower() == 'not':
            yield from _iter_leaves(node[1], not negated)
            return
        for child in node:
            # gli operatori (and/or, &, |) sono stringhe nude: skip
            if isinstance(child, str):
                continue
            yield from _iter_leaves(child, negated)


def _parse_safe(expr: str):
    """Parsa l'espressione e ritorna il root come lista/tupla. None se vuota o errore."""
    expr = (expr or "").strip()
    if not expr:
        return None
    try:
        res = build_parser().parseString(expr, parseAll=True)
        if len(res) == 0:
            return None
        return _as_list(res[0])
    except Exception:
        return None


def _load_lang_values(db: Session, lang_id: str) -> Dict[str, str]:
    """Mappa parameter_id -> value_eval finale per la lingua data."""
    rows = (
        db.query(
            models.LanguageParameter.parameter_id,
            models.LanguageParameterEval.value_eval,
        )
        .outerjoin(
            models.LanguageParameterEval,
            models.LanguageParameterEval.language_parameter_id == models.LanguageParameter.id,
        )
        .filter(models.LanguageParameter.language_id == lang_id)
        .all()
    )
    out: Dict[str, str] = {}
    for pid, val in rows:
        if val:
            out[pid] = val
    return out


# ---------------------------------------------------------------------------
# 1) Topologia del grafo (no lingua).
# ---------------------------------------------------------------------------

@router.get("")
def get_graph(
    include_inactive: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    q = db.query(models.ParameterDef)
    if not include_inactive:
        q = q.filter(models.ParameterDef.is_active == True)  # noqa: E712
    params = q.order_by(models.ParameterDef.position, models.ParameterDef.id).all()

    param_ids: Set[str] = {p.id for p in params}
    nodes = [
        {
            "id": p.id,
            "name": p.name or "",
            "label": p.id,
            "is_active": bool(p.is_active),
            "position": p.position,
            "schema": p.schema or "",
            "param_type": p.param_type or "",
            "level_of_comparison": p.level_of_comparison or "",
            "condition": p.implicational_condition or "",
        }
        for p in params
    ]

    edges_seen: Set[Tuple[str, str, str, bool]] = set()
    edges: List[dict] = []
    for p in params:
        root = _parse_safe(p.implicational_condition or "")
        if root is None:
            continue
        for sign, src, neg in _iter_leaves(root):
            if src not in param_ids or src == p.id:
                continue
            key = (src, p.id, sign, neg)
            if key in edges_seen:
                continue
            edges_seen.add(key)
            edges.append({
                "id": f"{src}__{'n' if neg else ''}{sign}__{p.id}",
                "source": src,
                "target": p.id,
                "sign": sign,
                "negated": neg,
            })

    return {"nodes": nodes, "edges": edges}


# ---------------------------------------------------------------------------
# 2) Valori finali per la lingua selezionata + soddisfacibilità di archi e
#    intera condizione. Usato per colorare nodi (background) e tratteggiare
#    edge non soddisfatti in modalità lingua.
# ---------------------------------------------------------------------------

@router.get("/lang-values")
def get_lang_values(
    lang: str = Query(..., min_length=1),
    include_inactive: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    language = db.query(models.Language).filter(models.Language.id == lang).first()
    if not language:
        raise HTTPException(status_code=404, detail="Language not found")

    values = _load_lang_values(db, lang)

    q = db.query(models.ParameterDef)
    if not include_inactive:
        q = q.filter(models.ParameterDef.is_active == True)  # noqa: E712
    params = q.all()
    param_ids: Set[str] = {p.id for p in params}

    nodes_out = []
    for p in params:
        v = values.get(p.id)
        final = v if v in ("+", "-", "0", "?") else "unset"
        condition_satisfied: Optional[bool] = None
        if (p.implicational_condition or "").strip():
            root = _parse_safe(p.implicational_condition or "")
            if root is not None:
                try:
                    condition_satisfied = bool(eval_node(root, values))
                except Exception:
                    condition_satisfied = None
        nodes_out.append({
            "id": p.id,
            "final": final,
            "condition_satisfied": condition_satisfied,
        })

    edges_out: List[dict] = []
    edges_seen: Set[Tuple[str, str, str, bool]] = set()
    for p in params:
        root = _parse_safe(p.implicational_condition or "")
        if root is None:
            continue
        for sign, src, neg in _iter_leaves(root):
            if src not in param_ids or src == p.id:
                continue
            key = (src, p.id, sign, neg)
            if key in edges_seen:
                continue
            edges_seen.add(key)
            cur = values.get(src)
            matches = (cur == sign)
            satisfied = (not matches) if neg else matches
            edges_out.append({
                "source": src,
                "target": p.id,
                "sign": sign,
                "negated": neg,
                "satisfied": satisfied,
            })

    return {
        "language": {"id": language.id, "name": language.name_full},
        "nodes": nodes_out,
        "edges": edges_out,
    }


# ---------------------------------------------------------------------------
# 3) Albero della condition decomposto (per il pannello laterale al click).
#    Riusa trace_evaluation_tree: ogni nodo ha label, type, result, children
#    e — se la lingua è data — actual_value per ogni foglia.
# ---------------------------------------------------------------------------

@router.get("/condition-tree/{param_id}")
def get_condition_tree(
    param_id: str,
    lang: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    p = db.query(models.ParameterDef).filter(models.ParameterDef.id == param_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Parameter not found")

    expr = (p.implicational_condition or "").strip()
    base = {
        "id": p.id,
        "name": p.name or "",
        "expression": expr,
        "evaluated": bool(lang),
        "tree": None,
    }
    if not expr:
        return base

    values: Dict[str, str] = _load_lang_values(db, lang) if lang else {}

    root = _parse_safe(expr)
    if root is None:
        return {**base, "error": "parse error"}

    try:
        tree = trace_evaluation_tree(root, values)
    except Exception as e:
        return {**base, "error": str(e)}

    return {**base, "tree": tree}
