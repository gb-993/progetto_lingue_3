from __future__ import annotations
from collections import defaultdict, deque
import re
from dataclasses import dataclass
from typing import Dict, List, Set, Tuple
from sqlalchemy.orm import Session

import models
from services.logic_parser import evaluate_with_parser # Assicurati che il percorso sia corretto

import logging
logger = logging.getLogger(__name__)

# per cercare Token parametri nelle condizioni: +FGM, -SCO, 0ABC
TOKEN_RE = re.compile(r"[+\-0]([A-Za-z0-9_]+)")

@dataclass
class DagReport:
    language_id: str
    processed: list[str]
    forced_zero: list[str]
    missing_orig: list[str]
    warnings_propagated: list[str]
    parse_errors: list[tuple[str, str, str]]


def _active_parameter_ids(db: Session) -> Set[str]:
    res = db.query(models.ParameterDef.id).filter(models.ParameterDef.is_active == True).all()
    return {r[0] for r in res}

def _extract_refs(cond: str) -> Set[str]:
    return {m.upper() for m in TOKEN_RE.findall(cond or "")}

def _build_graph_active(db: Session) -> Tuple[Dict[str, List[str]], Dict[str, str]]:
    """
    Crea il grafo delle dipendenze, mantenendo la tua logica originale.
    """
    active_ids = _active_parameter_ids(db)

    # Recupera i parametri attivi con la loro condizione
    params = db.query(models.ParameterDef.id, models.ParameterDef.implicational_condition).filter(
        models.ParameterDef.is_active == True
    ).all()

    edges = defaultdict(list)
    conditions = {}

    for pid, cond in params:
        if not cond or not cond.strip():
            continue

        refs = _extract_refs(cond)
        valid = True
        for r in refs:
            if r not in active_ids:
                valid = False
                break

        if valid:
            conditions[pid] = cond
            for r in refs:
                edges[r].append(pid)

    return edges, conditions

def run_dag_for_language(language_id: str, db: Session) -> DagReport:
    """
    Valuta il DAG per una lingua. Algoritmo originale conservato.
    """
    # 1. Recupero parametri originali dalla tabella LanguageParameter
    lp_list = db.query(models.LanguageParameter).filter(
        models.LanguageParameter.language_id == language_id
    ).all()

    lp_dict = {lp.parameter_id: lp for lp in lp_list}

    # prepariamo l'ambiente per il DAG
    edges, conditions = _build_graph_active(db)
    active_ids = _active_parameter_ids(db)

    # Grado in ingresso per topological sort
    in_degree = defaultdict(int)
    for ref, targets in edges.items():
        for t in targets:
            in_degree[t] += 1

    # Nodi con in-degree = 0 (radici)
    queue = deque([pid for pid in active_ids if in_degree[pid] == 0])

    # Tracciamento stato per logica
    cond_values: Dict[str, str] = {}
    missing_orig = []

    warnings = set()
    warnings_propagated = set()

    for pid in active_ids:
        lp = lp_dict.get(pid)
        if lp:
            if lp.value_orig:
                cond_values[pid] = lp.value_orig
            else:
                missing_orig.append(pid)
            if lp.warning_orig:
                warnings.add(pid)
        else:
            missing_orig.append(pid)

    processed = []
    forced_zero = []
    parse_errors = []

    # Esecuzione DAG Topologico
    while queue:
        target = queue.popleft()

        # Riduci in-degree per i figli
        for child in edges[target]:
            in_degree[child] -= 1
            if in_degree[child] == 0:
                queue.append(child)

        # Gestione record Eval
        lp = lp_dict.get(target)
        if not lp:
            # Creiamo il LP se manca, per poter creare poi il LPEval
            lp = models.LanguageParameter(language_id=language_id, parameter_id=target)
            db.add(lp)
            db.commit()
            db.refresh(lp)
            lp_dict[target] = lp

        lpe = db.query(models.LanguageParameterEval).filter(
            models.LanguageParameterEval.language_parameter_id == lp.id
        ).first()

        if not lpe:
            lpe = models.LanguageParameterEval(language_parameter_id=lp.id)
            db.add(lpe)

        v_orig = lp.value_orig
        cond = conditions.get(target)

        # --- INIZIO LOGICA DI VALUTAZIONE ORIGINALE ---
        if not cond:
            # Nessuna condizione implicazionale
            if v_orig is None:
                lpe.value_eval = "?"
                if target not in warnings:
                    warnings.add(target)
                    warnings_propagated.add(target)
            else:
                lpe.value_eval = v_orig
        else:
            refs = _extract_refs(cond)

            # Short-circuit se un padre ha un warning (?) ---
            if any(r in warnings for r in refs):
                if target not in warnings:
                    warnings.add(target)
                    warnings_propagated.add(target)

                lpe.value_eval = "?"
                lpe.warning_eval = True
                db.commit()
                db.refresh(lpe)
                cond_values[target] = "?"
                processed.append(target)
                continue
            try:
                parsed_ok = evaluate_with_parser(cond, cond_values)
                parse_error = None
            except Exception as e:
                parsed_ok = None
                parse_error = e

            cond_ok = parsed_ok if parse_error is None else None

            if cond_ok is False:
                lpe.value_eval = "0"
                forced_zero.append(target)
            elif cond_ok is True:
                if v_orig is None:
                    lpe.value_eval = "?"
                    if target not in warnings:
                        warnings.add(target)
                        warnings_propagated.add(target)
                else:
                    lpe.value_eval = v_orig
            else:
                lpe.value_eval = None
                if parse_error:
                    parse_errors.append((target, cond, str(parse_error)))

        # Check finale warning
        if target in warnings:
            lpe.value_eval = "?"

        lpe.warning_eval = (target in warnings)
        # --- FINE LOGICA DI VALUTAZIONE ORIGINALE ---

        db.commit()
        db.refresh(lpe)

        # Propagazione valore
        if lpe.value_eval:
            cond_values[target] = lpe.value_eval

        processed.append(target)

    return DagReport(
        language_id=language_id,
        processed=processed,
        forced_zero=forced_zero,
        missing_orig=missing_orig,
        warnings_propagated=sorted(warnings_propagated),
        parse_errors=parse_errors
    )