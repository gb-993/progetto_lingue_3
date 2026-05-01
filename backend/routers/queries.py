from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Dict, Any
import models
from dependencies import get_db, require_admin
from services.logic_parser import build_parser, evaluate_with_parser, pretty_print_expression, trace_evaluation_tree

router = APIRouter(prefix="/api/queries", tags=["Queries"])

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

# --- Q3: Neutralization Logic Tree ---
@router.get("/q3")
def query_3_neutralization(lang_id: str, param_id: str, db: Session = Depends(get_db)):
    lang = db.query(models.Language).filter(models.Language.id == lang_id).first()
    param = db.query(models.ParameterDef).filter(models.ParameterDef.id == param_id).first()
    if not lang or not param: raise HTTPException(404, "Data not found")

    cond = (param.implicational_condition or "").strip()
    if not cond:
        return {
            "no_condition": True,
            "parameter": {"id": param.id, "name": param.name},
            "language": {"id": lang.id, "name": lang.name_full}
        }

    vals_map = _final_map_for_language(db, lang_id)
    parser = build_parser()

    try:
        parsed_res = parser.parseString(cond, parseAll=True)
        # Genera l'albero JSON per il frontend invece del testo ASCII
        tree = trace_evaluation_tree(parsed_res[0], vals_map)
        return {
            "parameter": {"id": param.id, "name": param.name},
            "language": {"id": lang.id, "name": lang.name_full},
            "condition": cond,
            "is_neutralized": (tree["result"] is False),
            "tree": tree
        }
    except Exception as e:
        return {
            "error": str(e),
            "parameter": {"id": param.id, "name": param.name},
            "language": {"id": lang.id, "name": lang.name_full}
        }

# --- Q4, Q5, Q6: Parameters with value +, -, 0 ---
@router.get("/q456")
def query_456_values(lang_id: str, value: str, db: Session = Depends(get_db)):
    lang = db.query(models.Language).filter(models.Language.id == lang_id).first()
    if not lang: raise HTTPException(404, "Language not found")

    fmap = _final_map_for_language(db, lang_id)
    wanted_ids = [pid for pid, v in fmap.items() if v == value]

    params = db.query(models.ParameterDef).filter(models.ParameterDef.id.in_(wanted_ids)).order_by(models.ParameterDef.position).all()

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