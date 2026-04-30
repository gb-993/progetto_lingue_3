from __future__ import annotations
from collections import defaultdict, deque
import re
from dataclasses import dataclass
from typing import Dict, List, Set, Tuple
from sqlalchemy.orm import Session
from sqlalchemy.exc import NoResultFound

import models
from services.logic_parser import evaluate_with_parser

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

def _build_graph_active_scope(db: Session, active_ids: Set[str]) -> Tuple[Dict[str, List[str]], Dict[str, str]]:
    """
    Crea il grafo ref -> target SOLO per param attivi e solo se tutte le condizioni sono valide.
    """
    params = db.query(models.ParameterDef.id, models.ParameterDef.implicational_condition).filter(
        models.ParameterDef.is_active == True
    ).all()

    graph: Dict[str, List[str]] = {pid: [] for pid in active_ids}
    conditions: Dict[str, str] = {}

    for pid, cond in params:
        if not cond or not cond.strip():
            continue

        refs = _extract_refs(cond)
        if not refs:
            continue
        # Se la cond cita parametri fuori scope, ignora completamente la regola
        if not refs.issubset(active_ids):
            continue

        conditions[pid] = cond
        for r in refs:
            if pid not in graph[r]:
                graph[r].append(pid)

    return graph, conditions

def _topo_sort(graph: Dict[str, List[str]]) -> List[str]:
    """
    Ripristinato rigorosamente l'algoritmo originale di sort topologico
    per garantire il medesimo ordine di esecuzione.
    """
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

    if len(order) < len(indeg):
        order.extend([n for n in indeg if n not in order])
    return order


def run_dag_for_language(language_id: str, db: Session) -> DagReport:
    """
    Valuta il DAG per una lingua. Logica originale rigorosamente ripristinata.
    """
    # 1. Lock della riga lingua a livello DB (equivalente a select_for_update)
    try:
        lang = db.query(models.Language).with_for_update().filter(models.Language.id == language_id).one()
    except NoResultFound:
        raise ValueError(f"Language ID {language_id} not found.")

    active_ids = _active_parameter_ids(db)

    # 2. Crea il grafo e l'ordine topologico
    graph, cond_map = _build_graph_active_scope(db, active_ids)
    order = _topo_sort(graph)

    # 3. Precarica mappa param_id -> (lp_id, value_orig)
    lp_list = db.query(models.LanguageParameter).filter(
        models.LanguageParameter.language_id == language_id,
        models.LanguageParameter.parameter_id.in_(active_ids)
    ).all()

    lp_dict = {lp.parameter_id: lp for lp in lp_list}

    # Precarica gli eval esistenti in un'unica query per evitare N+1 nel loop
    lp_ids_existing = [lp.id for lp in lp_list if lp.id is not None]
    if lp_ids_existing:
        lpe_list = db.query(models.LanguageParameterEval).filter(
            models.LanguageParameterEval.language_parameter_id.in_(lp_ids_existing)
        ).all()
        lpe_by_lp_id: Dict[int, models.LanguageParameterEval] = {e.language_parameter_id: e for e in lpe_list}
    else:
        lpe_by_lp_id = {}

    # 4. Setup variabili per il tracciamento
    cond_values: Dict[str, str] = {} # RIPRISTINO: Inizializzato a vuoto!
    warnings: Set[str] = set()
    missing_orig: List[str] = []

    for pid in active_ids:
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
    parse_errors: list[tuple[str, str, str]] = []

    # 5. Esecuzione nodi in ordine topologico
    for target in order:
        lp = lp_dict.get(target)
        if not lp:
            lp = models.LanguageParameter(language_id=language_id, parameter_id=target, value_orig=None, warning_orig=False)
            db.add(lp)
            db.flush() # Salva a DB per avere l'ID senza chiudere la transazione
            lp_dict[target] = lp

        lpe = lpe_by_lp_id.get(lp.id)
        if not lpe:
            lpe = models.LanguageParameterEval(language_parameter_id=lp.id, value_eval="0", warning_eval=False)
            db.add(lpe)
            lpe_by_lp_id[lp.id] = lpe

        v_orig = lp.value_orig
        cond = (cond_map.get(target) or "").strip()

        # --- INIZIO LOGICA DI VALUTAZIONE ---
        if not cond:
            # Se manca la risposta, forziamo '?' e attiviamo il warning
            if v_orig is None:
                new_eval = "?"
                if target not in warnings:
                    warnings.add(target)
            # Se c'è già un warning (conflitto), il valore diventa '?'
            elif target in warnings:
                new_eval = "?"
            else:
                new_eval = v_orig if v_orig in ("+", "-") else None

            lpe.value_eval = new_eval
            lpe.warning_eval = (target in warnings)
            db.flush()

            # Aggiornamento cond_values progressivo (non pre-caricato!)
            if new_eval in ("+", "-", "0", "?"):
                cond_values[target] = new_eval

            processed.append(target)
            continue

        refs = _extract_refs(cond)

        # Short-circuit se i "padri" hanno un warning
        if any(r in warnings for r in refs):
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
            parsed_ok = evaluate_with_parser(cond, cond_values)
            parse_error = None
        except Exception as e:
            parsed_ok = None
            parse_error = e

        cond_ok = parsed_ok if parse_error is None else None

        if cond_ok is False:
            # Cond falsa: il parametro vale 0 in modo deterministico, indipendentemente dalle answers.
            # Un eventuale warning_orig (conflitto question/stop-question) resta visibile sulla colonna
            # input lato UI (arancione), ma non blocca lo 0 e non si propaga ai figli: rimuoviamo
            # quindi target dal set warnings cosi' i discendenti non short-circuitano.
            lpe.value_eval = "0"
            lpe.warning_eval = False
            warnings.discard(target)
            forced_zero.append(target)
            db.flush()
            cond_values[target] = "0"
            processed.append(target)
            continue

        if cond_ok is True:
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

        if target in warnings:
            lpe.value_eval = "?"

        lpe.warning_eval = (target in warnings)
        db.flush()

        # Registrazione del valore per i parametri successivi nel DAG
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