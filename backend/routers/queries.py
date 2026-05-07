from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from typing import List, Dict, Any
import models
from dependencies import get_db, require_admin
from services.logic_parser import build_parser, pretty_print_expression, eval_node, _as_list

# Tutti gli endpoint sono admin-only: la pagina /queries della SPA è admin-only
# e questi endpoint espongono dati cross-language (Q1-Q10) che non vanno
# accessibili a utenti non admin né tantomeno al pubblico. Dichiariamo la
# dipendenza a livello di router così non rischiamo di dimenticarla in nuovi
# endpoint aggiunti in futuro: nessun endpoint qui dentro deve restare aperto.
router = APIRouter(
    prefix="/api/queries",
    tags=["Queries"],
    dependencies=[Depends(require_admin)],
)

# --- Helper Functions (Migrate da views.py) ---
def _final_map_for_language(db: Session, lang_id: str) -> Dict[str, str]:
    out = {}
    # Selezioniamo direttamente parameter_id e value_eval per evitare N+1 query
    # (non triggera lazy-load della relazione language_parameter su ogni eval)
    rows = db.query(
        models.LanguageParameter.parameter_id,
        models.LanguageParameterEval.value_eval
    ).join(
        models.LanguageParameterEval,
        models.LanguageParameterEval.language_parameter_id == models.LanguageParameter.id
    ).filter(models.LanguageParameter.language_id == lang_id).all()
    for pid, val in rows:
        out[pid] = val

    origs = db.query(
        models.LanguageParameter.parameter_id,
        models.LanguageParameter.value_orig
    ).filter(models.LanguageParameter.language_id == lang_id).all()
    for pid, val in origs:
        out.setdefault(pid, val)
    return out

def _extract_tokens(expr: str) -> List[str]:
    import re
    TOKEN_RE = re.compile(r'([+\-0])([A-Za-z][A-Za-z0-9_]*)')
    return [t[1] for t in TOKEN_RE.findall((expr or "").strip().upper())]

# --- Q1: Implicational Conditions ---
@router.get("/q1")
def query_1_implications(param_id: str, db: Session = Depends(get_db)):
    param = db.query(models.ParameterDef).filter(models.ParameterDef.id == param_id).first()
    if not param: raise HTTPException(404, "Parameter not found")

    refs_in_param = _extract_tokens(param.implicational_condition or "")

    implicating = db.query(models.ParameterDef).filter(models.ParameterDef.id.in_(refs_in_param)).order_by(models.ParameterDef.position).all()

    implicated = []
    # CORREZIONE: Usiamo != invece di .exclude() che era specifico per Django
    all_params = db.query(models.ParameterDef).filter(models.ParameterDef.id != param.id).all()
    for p in all_params:
        if param.id in _extract_tokens(p.implicational_condition or ""):
            implicated.append({"id": p.id, "name": p.name})

    return {
        "parameter": {"id": param.id, "name": param.name},
        "raw_condition": param.implicational_condition,
        "pretty_condition": pretty_print_expression(param.implicational_condition),
        "implicating": [{"id": p.id, "name": p.name} for p in implicating],
        "implicated": implicated
    }

# --- Q2: Parameter values distribution ---
@router.get("/q2")
def query_2_distribution(param_id: str, db: Session = Depends(get_db)):
    param = db.query(models.ParameterDef).filter(models.ParameterDef.id == param_id).first()
    if not param: raise HTTPException(404, "Parameter not found")

    # CORREZIONE: Mappiamo le lingue qui in Python per evitare errori "AttributeError"
    # se la relazione diretta su LanguageParameter manca nel models.py
    all_langs = {l.id: l.name_full for l in db.query(models.Language).all()}

    plus, minus, zero = [], [], []
    # Selezioniamo direttamente le colonne per evitare N+1 query sulla relazione language_parameter
    eval_rows = db.query(
        models.LanguageParameter.language_id,
        models.LanguageParameterEval.value_eval
    ).join(
        models.LanguageParameterEval,
        models.LanguageParameterEval.language_parameter_id == models.LanguageParameter.id
    ).filter(models.LanguageParameter.parameter_id == param_id).all()
    seen_langs = set()

    for lang_id, val in eval_rows:
        if not lang_id: continue
        seen_langs.add(lang_id)
        item = {"id": lang_id, "name": all_langs.get(lang_id, "Unknown")}

        if val == "+": plus.append(item)
        elif val == "-": minus.append(item)
        elif val == "0": zero.append(item)

    origs = db.query(models.LanguageParameter).filter(models.LanguageParameter.parameter_id == param_id).all()
    for o in origs:
        if o.language_id in seen_langs or not o.language_id: continue
        val = o.value_orig
        item = {"id": o.language_id, "name": all_langs.get(o.language_id, "Unknown")}

        if val == "+": plus.append(item)
        elif val == "-": minus.append(item)

    return {"parameter": {"id": param.id, "name": param.name}, "plus": plus, "minus": minus, "zero": zero}

# --- Q3: Neutralization Blame Analysis ---

def _eval_subtree_safe(node, values: Dict[str, str]) -> bool:
    try:
        return bool(eval_node(node, values))
    except Exception:
        return False


def _blame_walk(node, matters: bool, negated: bool, values: Dict[str, str], responsible: list, other: list) -> None:
    """
    Cammina l'AST della cond e classifica le foglie:
      - matters=True  -> finiscono in `responsible` (le foglie il cui valore conta per il risultato)
      - matters=False -> finiscono in `other` (rami che non influenzano il risultato attuale)
    Regole su matters: AND vero => tutti rilevanti; AND falso => solo i figli False rilevanti.
    OR vero => solo i figli True rilevanti; OR falso => tutti rilevanti. NOT trasparente per matters.
    `negated` traccia il numero di NOT a monte (mod 2): True se la foglia e' sotto un numero
    dispari di NOT, False altrimenti. Serve al frontend per mostrare correttamente il "Required".
    """
    if isinstance(node, tuple):
        sign, param = node
        current = values.get(param)
        leaf_eval = (current == sign)
        entry = {
            "sign": sign,
            "param_id": param,
            "current": current,
            "leaf_eval": leaf_eval,
            "negated": negated,
        }
        (responsible if matters else other).append(entry)
        return

    node_l = _as_list(node)

    # NOT <expr>: trasparente per `matters`, flippa `negated`
    if isinstance(node_l, list) and len(node_l) == 2 and str(node_l[0]).lower() == 'not':
        _blame_walk(node_l[1], matters, not negated, values, responsible, other)
        return

    # AND/OR chain: [A op B op C ...]
    if isinstance(node_l, list) and len(node_l) >= 3 and len(node_l) % 2 == 1:
        op_kind = 'and' if str(node_l[1]).lower() in ('&', 'and') else 'or'
        children = [node_l[i] for i in range(0, len(node_l), 2)]

        if not matters:
            for c in children:
                _blame_walk(c, False, negated, values, responsible, other)
            return

        child_actuals = [_eval_subtree_safe(c, values) for c in children]

        if op_kind == 'and':
            if all(child_actuals):
                for c in children:
                    _blame_walk(c, True, negated, values, responsible, other)
            else:
                for c, ar in zip(children, child_actuals):
                    _blame_walk(c, not ar, negated, values, responsible, other)
        else:  # or
            if any(child_actuals):
                for c, ar in zip(children, child_actuals):
                    _blame_walk(c, ar, negated, values, responsible, other)
            else:
                for c in children:
                    _blame_walk(c, True, negated, values, responsible, other)


def _attach_param_names(db: Session, leaves: list) -> None:
    if not leaves:
        return
    ids = list({e["param_id"] for e in leaves})
    rows = db.query(models.ParameterDef.id, models.ParameterDef.name).filter(
        models.ParameterDef.id.in_(ids)
    ).all()
    name_by_id = {pid: pname for pid, pname in rows}
    for e in leaves:
        e["param_name"] = name_by_id.get(e["param_id"], "")


def _get_param_state(db: Session, lang_id: str, param_id: str) -> dict:
    lp = db.query(models.LanguageParameter).filter(
        models.LanguageParameter.language_id == lang_id,
        models.LanguageParameter.parameter_id == param_id,
    ).first()
    if not lp:
        return {"value_orig": None, "value_eval": None, "warning_orig": False, "warning_eval": False}
    lpe = lp.eval
    return {
        "value_orig": lp.value_orig,
        "value_eval": lpe.value_eval if lpe else None,
        "warning_orig": bool(lp.warning_orig),
        "warning_eval": bool(lpe.warning_eval) if lpe else False,
    }


def _originating_answers(db: Session, lang_id: str, param_id: str) -> list:
    rows = db.query(models.Answer, models.Question).join(
        models.Question, models.Answer.question_id == models.Question.id
    ).filter(
        models.Answer.language_id == lang_id,
        models.Question.parameter_id == param_id,
    ).all()
    return [
        {
            "q_id": q.id,
            "q_text": q.text,
            "response": a.response_text,
            "is_stop_question": bool(q.is_stop_question),
        }
        for a, q in rows
    ]


def _parents_with_warning(db: Session, lang_id: str, parent_ids: set) -> list:
    if not parent_ids:
        return []
    rows = db.query(
        models.LanguageParameter.parameter_id,
        models.ParameterDef.name,
        models.LanguageParameterEval.warning_eval,
    ).join(
        models.LanguageParameterEval,
        models.LanguageParameterEval.language_parameter_id == models.LanguageParameter.id,
    ).join(
        models.ParameterDef,
        models.ParameterDef.id == models.LanguageParameter.parameter_id,
    ).filter(
        models.LanguageParameter.language_id == lang_id,
        models.LanguageParameter.parameter_id.in_(list(parent_ids)),
    ).all()
    return [{"id": pid, "name": pname} for pid, pname, w in rows if w]


@router.get("/q3")
def query_3_neutralization(lang_id: str, param_id: str, db: Session = Depends(get_db)):
    lang = db.query(models.Language).filter(models.Language.id == lang_id).first()
    param = db.query(models.ParameterDef).filter(models.ParameterDef.id == param_id).first()
    if not lang or not param:
        raise HTTPException(404, "Data not found")

    cond = (param.implicational_condition or "").strip()
    state = _get_param_state(db, lang_id, param_id)
    value_eval = state["value_eval"]
    value_orig = state["value_orig"]
    warning_eval = state["warning_eval"]

    base = {
        "parameter": {"id": param.id, "name": param.name},
        "language": {"id": lang.id, "name": lang.name_full},
        "current_value": value_eval,
        "value_orig": value_orig,
        "condition": cond,
    }

    # Caso 1: nessuna condizione implicazionale.
    if not cond:
        if value_eval in ("+", "-"):
            status = "active"
            explanation = {"type": "active_no_condition", "answers": _originating_answers(db, lang_id, param_id)}
        elif value_eval == "0":
            status = "set_directly"
            explanation = {"type": "answered_directly", "answers": _originating_answers(db, lang_id, param_id)}
        elif value_eval == "?":
            status = "warning_propagated" if warning_eval else "no_answers"
            explanation = {"type": "no_condition", "answers": _originating_answers(db, lang_id, param_id)}
        else:
            status = "no_answers"
            explanation = {"type": "no_condition", "answers": _originating_answers(db, lang_id, param_id)}
        return {**base, "status": status, "explanation": explanation}

    # Caso 2: condizione presente -> parsing.
    parser = build_parser()
    try:
        parsed = parser.parseString(cond, parseAll=True)
        root_ast = _as_list(parsed[0])
    except Exception as e:
        return {**base, "status": "parse_error", "explanation": {"type": "parse_error", "message": str(e)}}

    # Mappa valori correnti, normalizzata in uppercase per coerenza con il parser.
    raw_vals = _final_map_for_language(db, lang_id)
    values = {k.upper(): v for k, v in raw_vals.items()}

    try:
        cond_ok = bool(eval_node(root_ast, values))
    except Exception as e:
        return {**base, "status": "parse_error", "explanation": {"type": "parse_error", "message": str(e)}}

    # Decisione status quando la cond e' parsabile.
    if cond_ok is False:
        status = "neutralized"
    elif value_eval == "?" and warning_eval:
        status = "warning_propagated"
    elif value_eval == "0":
        status = "set_directly"
    elif value_eval in ("+", "-"):
        status = "active"
    else:
        status = "no_answers"

    if status in ("neutralized", "active"):
        responsible: list = []
        other: list = []
        _blame_walk(root_ast, True, False, values, responsible, other)
        _attach_param_names(db, responsible)
        _attach_param_names(db, other)
        explanation = {
            "type": "implication_failed" if status == "neutralized" else "implication_satisfied",
            "responsible": responsible,
            "other_tokens": other,
            "answers": _originating_answers(db, lang_id, param_id),
        }
    elif status == "set_directly":
        explanation = {
            "type": "answered_directly",
            "answers": _originating_answers(db, lang_id, param_id),
        }
    elif status == "warning_propagated":
        refs = set(_extract_tokens(cond))
        explanation = {"type": "warning_from_parents", "parents": _parents_with_warning(db, lang_id, refs)}
    else:  # no_answers
        explanation = {"type": "no_answers", "answers": _originating_answers(db, lang_id, param_id)}

    return {**base, "status": status, "explanation": explanation}

# --- Q4, Q5, Q6: Parameters with value +, -, 0 ---
@router.get("/q456")
def query_456_values(lang_id: str, value: str, db: Session = Depends(get_db)):
    lang = db.query(models.Language).filter(models.Language.id == lang_id).first()
    if not lang: raise HTTPException(404, "Language not found")

    fmap = _final_map_for_language(db, lang_id)
    wanted_ids = [pid for pid, v in fmap.items() if v == value]

    params = db.query(models.ParameterDef).filter(
        models.ParameterDef.id.in_(wanted_ids),
        models.ParameterDef.is_active == True,
    ).order_by(models.ParameterDef.position).all()

    return {
        "language": {"id": lang.id, "name": lang.name_full},
        "params": [{"id": p.id, "name": p.name, "condition": p.implicational_condition, "pretty": pretty_print_expression(p.implicational_condition)} for p in params]
    }

# --- Q7: Comparable parameters ---
@router.get("/q7")
def query_7_comparable(lang_a: str, lang_b: str, db: Session = Depends(get_db)):
    map_a = _final_map_for_language(db, lang_a)
    map_b = _final_map_for_language(db, lang_b)

    rows = []
    params = db.query(models.ParameterDef).filter(models.ParameterDef.is_active == True).order_by(models.ParameterDef.position).all()

    for p in params:
        va, vb = map_a.get(p.id), map_b.get(p.id)
        if va in {"+", "-"} and vb in {"+", "-"}:
            rows.append({"id": p.id, "name": p.name, "val_a": va, "val_b": vb})

    return {"rows": rows}

# --- Q10 helpers / endpoints ---
@router.get("/options/questions-for-language")
def options_questions_for_language(lang_id: str, db: Session = Depends(get_db)):
    """Lista degli ID delle question già risposte dalla lingua indicata.

    Serve a Q10 lato frontend per restringere il dropdown delle question
    quando l'utente vuole vedere solo quelle effettivamente compilate per
    una specifica lingua. Risposta vuota o null comprese: include qualsiasi
    riga Answer esistente.
    """
    rows = (
        db.query(models.Answer.question_id)
        .filter(models.Answer.language_id == lang_id)
        .distinct()
        .all()
    )
    return [r[0] for r in rows]


# --- Q10: Answers and examples per question (cross-language) ---
@router.get("/by-question")
def query_by_question(q_id: str, db: Session = Depends(get_db)):
    """Per una singola question, ritorna una riga per ogni lingua con la
    risposta (yes/no/unsure/None) e tutti gli esempi associati.

    Lingue senza Answer per questa question vengono comunque incluse, con
    response=None ed examples=[]: comodo per vedere chi non ha ancora risposto.
    """
    question = (
        db.query(models.Question)
        .options(joinedload(models.Question.parameter))
        .filter(models.Question.id == q_id)
        .first()
    )
    if not question:
        raise HTTPException(404, "Question not found")

    langs = db.query(models.Language).order_by(models.Language.name_full).all()

    # joinedload su examples evita N+1 (una sola query con join).
    answers = (
        db.query(models.Answer)
        .options(joinedload(models.Answer.examples))
        .filter(models.Answer.question_id == q_id)
        .all()
    )
    answer_by_lang = {a.language_id: a for a in answers}

    rows = []
    for lang in langs:
        a = answer_by_lang.get(lang.id)
        examples = []
        if a:
            # Ordina per `number` (lessicografico): "1", "2", "10" -> "1", "10", "2"
            # è accettabile, gli esempi sono sempre 2-5 in pratica.
            for ex in sorted(a.examples, key=lambda x: (x.number or "")):
                examples.append({
                    "id": ex.id,
                    "number": ex.number,
                    "textarea": ex.textarea,
                    "transliteration": ex.transliteration,
                    "gloss": ex.gloss,
                    "translation": ex.translation,
                    "reference": ex.reference,
                })
        rows.append({
            "language": {"id": lang.id, "name": lang.name_full},
            "response": a.response_text if a else None,
            "comments": (a.comments if a else None) or "",
            "examples": examples,
        })

    return {
        "question": {
            "id": question.id,
            "text": question.text,
            "parameter_id": question.parameter_id,
            "parameter_name": question.parameter.name if question.parameter else None,
            "is_active": bool(question.is_active),
        },
        "rows": rows,
    }


# --- Q8, Q9: Questions with answer YES/NO ---
@router.get("/q89")
def query_89_answers(lang_id: str, response_text: str, db: Session = Depends(get_db)):
    lang = db.query(models.Language).filter(models.Language.id == lang_id).first()
    if not lang: raise HTTPException(404, "Language not found")

    answers = db.query(models.Answer).join(models.Question).filter(
        models.Answer.language_id == lang_id,
        models.Answer.response_text == response_text.lower(),
        models.Question.is_active == True,
    ).all()

    res = []
    for a in answers:
        res.append({"q_id": a.question_id, "text": a.question.text, "p_id": a.question.parameter_id})

    # Ordina per p_id (approssimazione ordinamento parametro)
    res.sort(key=lambda x: x["p_id"])
    return {"language": {"id": lang.id, "name": lang.name_full}, "answers": res}