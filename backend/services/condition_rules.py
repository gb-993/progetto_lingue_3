"""Regole sulle condizioni dei parametri (es. `+FGM & -SCO`).

Una condizione dice quando un parametro è applicabile. Prima di salvarla si
controlla che sia scritta bene, che citi solo parametri esistenti e attivi, e
che non crei un giro chiuso (A dipende da B, che dipende da A): con un giro il
calcolo dei valori finali non avrebbe un punto da cui partire.
"""
from __future__ import annotations

import re
from typing import Dict, Iterable, List, Optional, Set, Tuple

from sqlalchemy.orm import Session

import models
from services.logic_parser import ParseException, validate_expression

# token nelle condizioni: +FGM, -SCO, 0ABC
TOKEN_RE = re.compile(r"[+\-0]([A-Za-z0-9_]+)")

# id del parametro (maiuscolo) -> (condizione, attivo)
ParamState = Dict[str, Tuple[Optional[str], bool]]


class ConditionError(ValueError):
    """Condizione da rifiutare; il messaggio è per l'utente."""


def extract_refs(cond: Optional[str]) -> Set[str]:
    """Parametri citati in una condizione, in maiuscolo."""
    return {m.upper() for m in TOKEN_RE.findall(cond or "")}


def parameters_citing(db: Session, param_id: str) -> List[models.ParameterDef]:
    """Parametri, attivi e spenti, che citano `param_id` nella loro condizione."""
    target = param_id.upper()
    rows = (
        db.query(models.ParameterDef)
        .filter(models.ParameterDef.implicational_condition.isnot(None))
        .order_by(models.ParameterDef.position, models.ParameterDef.id)
        .all()
    )
    return [p for p in rows if p.id.upper() != target and target in extract_refs(p.implicational_condition)]


def find_dependency_path(deps: Dict[str, Set[str]], start: str, goal: str) -> Optional[List[str]]:
    """Catena `start → … → goal` seguendo "dipende da"; None se non esiste."""
    stack = [(start, [start])]
    seen = {start}
    while stack:
        node, path = stack.pop()
        for cited in sorted(deps.get(node, ())):
            if cited == goal:
                return path + [goal]
            if cited not in seen:
                seen.add(cited)
                stack.append((cited, path + [cited]))
    return None


def find_cycles(deps: Dict[str, Set[str]]) -> List[List[str]]:
    """Giri chiusi fra le dipendenze, ognuno come [A, B, …, A]."""
    cycles: List[List[str]] = []
    in_a_cycle: Set[str] = set()
    for pid in sorted(deps):
        if pid in in_a_cycle:
            continue
        path = find_dependency_path(deps, pid, pid)
        if path:
            cycles.append(path)
            in_a_cycle.update(path)
    return cycles


def format_cycle(path: List[str]) -> str:
    return " → ".join(path)


def condition_problem(pid: str, state: ParamState, own_ids: Iterable[str] = ()) -> Optional[str]:
    """Perché la condizione di `pid` non è accettabile nello stato dato; None se va bene."""
    cond, is_active = state[pid]
    refs = extract_refs(cond)
    if not refs:
        return None

    if refs & {pid, *own_ids}:
        return "A parameter cannot be cited in its own condition."

    unknown = sorted(refs - state.keys())
    if unknown:
        return f"The condition cites parameters that do not exist: {', '.join(unknown)}."

    # un parametro attivo non può dipendere da uno spento
    if is_active:
        inactive = sorted(r for r in refs if not state[r][1])
        if inactive:
            return f"The condition cites deactivated parameters: {', '.join(inactive)}."

    deps = {p: extract_refs(c) for p, (c, _active) in state.items() if c}
    cycle = find_dependency_path(deps, pid, pid)
    if cycle:
        return (
            f"The condition creates a circular dependency: {format_cycle(cycle)} "
            "(each parameter depends on the next one)."
        )
    return None


def load_state(db: Session) -> ParamState:
    rows = db.query(
        models.ParameterDef.id,
        models.ParameterDef.implicational_condition,
        models.ParameterDef.is_active,
    ).all()
    return {pid.upper(): (cond, bool(active)) for pid, cond, active in rows}


def check_condition(
    db: Session,
    param_id: str,
    condition: Optional[str],
    *,
    is_active: bool = True,
    other_own_ids: Iterable[str] = (),
) -> None:
    """Controllo fatto quando si salva o si riattiva un parametro.

    Solleva ConditionError se la condizione romperebbe il calcolo dei valori.
    `other_own_ids`: altri id dello stesso parametro (il nuovo id in una rinomina).
    """
    cond = (condition or "").strip()
    if not cond:
        return
    try:
        validate_expression(cond)
    except ParseException as e:
        raise ConditionError(f"Wrong formula syntax: {e}")

    pid = param_id.upper()
    state = load_state(db)
    state[pid] = (cond, is_active)
    problem = condition_problem(pid, state, {o.upper() for o in other_own_ids if o})
    if problem:
        raise ConditionError(problem)


def rejected_changes(current: ParamState, planned: ParamState) -> Dict[str, Tuple[str, str]]:
    """Per una modifica di più parametri insieme (import Excel): quali rifiutare.

    Ritorna id -> (campo, motivo), con campo "condition" oppure "is_active".
    Una modifica rifiutata lascia il parametro com'era, e questo può rendere
    inaccettabile un'altra modifica: per questo si ripete finché non cambia più nulla.
    """
    rejected: Dict[str, Tuple[str, str]] = {}
    while True:
        accepted = {pid: value for pid, value in planned.items() if pid not in rejected}
        state = {**current, **accepted}
        newly_rejected: Dict[str, Tuple[str, str]] = {}

        for pid, (cond, is_active) in state.items():
            # parametri citati da `pid` che questa importazione vorrebbe spegnere
            being_deactivated = sorted(
                r for r in extract_refs(cond)
                if is_active and r in accepted and not state[r][1]
                and current.get(r, (None, False))[1]
            )
            for cited in being_deactivated:
                newly_rejected.setdefault(cited, (
                    "is_active",
                    f"Cannot deactivate: the parameter is used in the condition of active parameter {pid}.",
                ))
            if being_deactivated or pid not in accepted:
                continue

            problem = condition_problem(pid, state)
            if problem:
                newly_rejected[pid] = ("condition", problem)

        if not newly_rejected:
            return rejected
        rejected.update(newly_rejected)
