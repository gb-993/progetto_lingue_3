"""Secondo passo del calcolo dei valori: le dipendenze fra parametri.

Il primo passo (param_consolidate) ricava dalle risposte il valore grezzo di
ogni parametro. Qui si applicano le condizioni: un parametro con la condizione
falsa vale '0', uno che dipende da un parametro incerto vale '?'. Il risultato
è il valore finale (value_eval), quello usato da Tabella A, distanze e grafici.
"""
from __future__ import annotations
from collections import deque
from dataclasses import dataclass
from typing import Any, Dict, List, Set
from sqlalchemy.orm import Session
from sqlalchemy.exc import NoResultFound

import models
from services.condition_rules import extract_refs, find_cycles, format_cycle
from services.logic_parser import eval_node, parse_condition

import logging
logger = logging.getLogger(__name__)


@dataclass
class DagReport:
    language_id: str
    processed: list[str]
    forced_zero: list[str]
    missing_orig: list[str]
    warnings_propagated: list[str]
    # condizioni inutilizzabili: (parametro, condizione, motivo)
    formula_errors: list[tuple[str, str, str]]


@dataclass
class _Plan:
    """Cosa serve per calcolare una lingua; dipende solo dai parametri, non dalla lingua."""
    order: List[str]                # parametri nell'ordine in cui vanno calcolati
    conditions: Dict[str, str]      # parametro -> testo della condizione
    trees: Dict[str, Any]           # parametro -> condizione già letta
    refs: Dict[str, Set[str]]       # parametro -> parametri da cui dipende
    broken: Dict[str, str]          # parametro -> perché la sua condizione è inutilizzabile


def _active_parameter_ids(db: Session) -> Set[str]:
    res = db.query(models.ParameterDef.id).filter(models.ParameterDef.is_active == True).all()
    return {r[0] for r in res}


def _plan_evaluation(db: Session) -> _Plan:
    """Legge le condizioni dei parametri attivi e decide l'ordine di calcolo."""
    active_ids = _active_parameter_ids(db)
    rows = db.query(models.ParameterDef.id, models.ParameterDef.implicational_condition).filter(
        models.ParameterDef.is_active == True
    ).all()
    conditions = {pid: cond.strip() for pid, cond in rows if cond and cond.strip()}

    trees: Dict[str, Any] = {}
    refs: Dict[str, Set[str]] = {}
    broken: Dict[str, str] = {}

    # Il salvataggio rifiuta già queste condizioni (condition_rules). Qui si
    # ricontrolla per i dati entrati da altre strade: meglio un '?' dichiarato
    # che un valore sbagliato in silenzio.
    for pid, cond in conditions.items():
        try:
            tree = parse_condition(cond)
        except Exception as e:
            broken[pid] = f"wrong formula syntax ({e})"
            continue
        cited = extract_refs(cond)
        unusable = sorted(cited - active_ids)
        if unusable:
            broken[pid] = f"cites parameters that do not exist or are deactivated: {', '.join(unusable)}"
            continue
        trees[pid] = tree
        refs[pid] = cited

    # giri chiusi: nessuno dei parametri coinvolti ha un valore sensato
    for cycle in find_cycles(refs):
        for pid in cycle[:-1]:
            broken.setdefault(pid, f"circular dependency: {format_cycle(cycle)}")
    for pid in broken:
        trees.pop(pid, None)
        refs.pop(pid, None)

    # frecce "citato -> chi lo cita": servono a calcolare prima i parametri citati
    graph: Dict[str, List[str]] = {pid: [] for pid in sorted(active_ids)}
    for pid in sorted(refs):
        for cited in sorted(refs[pid]):
            graph[cited].append(pid)

    return _Plan(order=_topo_sort(graph), conditions=conditions, trees=trees, refs=refs, broken=broken)


def _topo_sort(graph: Dict[str, List[str]]) -> List[str]:
    """Mette i parametri in fila: ognuno viene dopo quelli da cui dipende (Kahn)."""
    indeg = {n: 0 for n in graph}
    for u, outs in graph.items():
        for v in outs:
            indeg[v] = indeg.get(v, 0) + 1

    q = deque([n for n, d in indeg.items() if d == 0])
    order: List[str] = []
    while q:
        u = q.popleft()
        order.append(u)
        for v in graph.get(u, []):
            indeg[v] -= 1
            if indeg[v] == 0:
                q.append(v)

    # i giri sono già stati tolti: qui non dovrebbe restare nessuno
    if len(order) < len(indeg):
        order.extend([n for n in indeg if n not in order])
    return order


def formula_problems(db: Session) -> List[dict]:
    """Condizioni che il calcolo non può usare (uguali per tutte le lingue)."""
    plan = _plan_evaluation(db)
    return [
        {"param_id": pid, "condition": plan.conditions[pid], "reason": reason}
        for pid, reason in sorted(plan.broken.items())
    ]


def run_dag_for_language(language_id: str, db: Session) -> DagReport:
    """Calcola il valore finale di tutti i parametri attivi di una lingua."""
    # lock sulla lingua: niente valutazioni in parallelo
    try:
        lang = db.query(models.Language).with_for_update().filter(models.Language.id == language_id).one()
    except NoResultFound:
        raise ValueError(f"Language ID {language_id} not found.")

    plan = _plan_evaluation(db)

    lp_list = db.query(models.LanguageParameter).filter(
        models.LanguageParameter.language_id == language_id,
        models.LanguageParameter.parameter_id.in_(plan.order)
    ).all()

    lp_dict = {lp.parameter_id: lp for lp in lp_list}

    lp_ids_existing = [lp.id for lp in lp_list if lp.id is not None]
    if lp_ids_existing:
        lpe_list = db.query(models.LanguageParameterEval).filter(
            models.LanguageParameterEval.language_parameter_id.in_(lp_ids_existing)
        ).all()
        lpe_by_lp_id: Dict[int, models.LanguageParameterEval] = {e.language_parameter_id: e for e in lpe_list}
    else:
        lpe_by_lp_id = {}

    # valori finali dei parametri già calcolati: li leggono le condizioni di quelli dopo
    cond_values: Dict[str, str] = {}
    # parametri incerti: chi dipende da uno di loro diventa '?'
    warnings: Set[str] = set()
    missing_orig: List[str] = []

    for pid in plan.order:
        lp = lp_dict.get(pid)
        if lp:
            if lp.warning_orig:
                warnings.add(pid)
            if lp.value_orig is None:
                missing_orig.append(pid)
        else:
            missing_orig.append(pid)

    processed: list[str] = []
    forced_zero: list[str] = []
    warnings_propagated: set[str] = set()
    formula_errors: list[tuple[str, str, str]] = []

    for target in plan.order:
        lp = lp_dict.get(target)
        if not lp:
            lp = models.LanguageParameter(language_id=language_id, parameter_id=target, value_orig=None, warning_orig=False)
            db.add(lp)
            db.flush()  # serve l'id per l'eval
            lp_dict[target] = lp

        lpe = lpe_by_lp_id.get(lp.id)
        if not lpe:
            lpe = models.LanguageParameterEval(language_parameter_id=lp.id, value_eval="0", warning_eval=False)
            db.add(lpe)
            lpe_by_lp_id[lp.id] = lpe

        v_orig = lp.value_orig

        def mark_unusable(reason: str) -> None:
            # condizione inutilizzabile: '?', che passa anche a chi dipende da questo parametro
            warnings.add(target)
            lpe.value_eval = "?"
            lpe.warning_eval = True
            db.flush()
            cond_values[target] = "?"
            formula_errors.append((target, plan.conditions[target], reason))
            processed.append(target)

        if target in plan.broken:
            mark_unusable(plan.broken[target])
            continue

        tree = plan.trees.get(target)

        # senza condizione: il valore finale è quello grezzo
        if tree is None:
            if v_orig is None:
                new_eval = "?"
                if target not in warnings:
                    warnings.add(target)
            elif target in warnings:
                new_eval = "?"
            else:
                new_eval = v_orig if v_orig in ("+", "-") else None

            lpe.value_eval = new_eval
            lpe.warning_eval = (target in warnings)
            db.flush()

            if new_eval in ("+", "-", "0", "?"):
                cond_values[target] = new_eval

            processed.append(target)
            continue

        # un parametro citato è incerto: non si può decidere, quindi '?'
        if any(r in warnings for r in plan.refs[target]):
            if target not in warnings:
                warnings.add(target)
                warnings_propagated.add(target)

            lpe.value_eval = "?"
            lpe.warning_eval = True
            db.flush()

            cond_values[target] = "?"
            processed.append(target)
            continue

        try:
            cond_ok = eval_node(tree, cond_values)
        except Exception as e:
            mark_unusable(f"cannot be evaluated ({e})")
            continue

        if not cond_ok:
            # condizione falsa: 0, e il warning non passa ai figli (DEV-NOTES)
            lpe.value_eval = "0"
            lpe.warning_eval = False
            warnings.discard(target)
            forced_zero.append(target)
            db.flush()
            cond_values[target] = "0"
            processed.append(target)
            continue

        # condizione vera: vale il valore grezzo
        if v_orig is None:
            lpe.value_eval = "?"
            if target not in warnings:
                warnings.add(target)
                warnings_propagated.add(target)
        else:
            lpe.value_eval = v_orig

        if target in warnings:
            lpe.value_eval = "?"

        lpe.warning_eval = (target in warnings)
        db.flush()

        if lpe.value_eval:
            cond_values[target] = lpe.value_eval

        processed.append(target)

    if formula_errors:
        logger.warning(
            "DAG %s: unusable conditions, value set to '?': %s",
            language_id, "; ".join(f"{pid} ({reason})" for pid, _cond, reason in formula_errors),
        )

    return DagReport(
        language_id=language_id,
        processed=processed,
        forced_zero=forced_zero,
        missing_orig=missing_orig,
        warnings_propagated=sorted(warnings_propagated),
        formula_errors=formula_errors
    )
