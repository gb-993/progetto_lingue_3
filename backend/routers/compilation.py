from typing import List, Optional, Dict
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func
import models
from dependencies import get_db, get_current_user, require_admin
from services.logic_parser import evaluate_with_parser
from services.dag_eval import run_dag_for_language
from services.param_consolidate import recompute_and_persist_language_parameter


# Stati in cui la lingua è bloccata in scrittura per gli utenti normali
LOCKED_STATUSES = ("waiting_for_approval", "approved")


def _ensure_can_modify(language: models.Language, current_user: models.User):
    """
    Permessi di modifica:
      - admin: SEMPRE, a prescindere dallo status (può fix/edit anche su waiting/approved/rejected)
      - utente assegnato: solo se la lingua NON è bloccata (pending o rejected)
      - chiunque altro: 403
    """
    if current_user.role == "admin":
        return
    if language.assigned_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Non sei autorizzato a modificare questa lingua.")
    if language.status in LOCKED_STATUSES:
        raise HTTPException(
            status_code=409,
            detail=f"Lingua bloccata (stato: {language.status}). Attendi la revisione admin o riaprila."
        )


router = APIRouter(prefix="/api/languages", tags=["Compilation & Workflow"])

# --- SCHEMI PYDANTIC ---
class ExampleInput(BaseModel):
    id: Optional[int] = None
    textarea: str = ""
    transliteration: str = ""
    gloss: str = ""
    translation: str = ""
    reference: str = ""

class QuestionAnswerPayload(BaseModel):
    question_id: str
    response_text: str
    comments: str = ""
    motivation_ids: List[int] = []
    examples: List[ExampleInput] = []

class ParameterBlockSavePayload(BaseModel):
    answers: List[QuestionAnswerPayload]
    is_unsure: bool
    # Timestamp del blocco visto dal client al caricamento (ISO 8601). Se al save
    # il MAX(updated_at) corrente è diverso, qualcun altro ha modificato nel mentre:
    # rispondiamo 409 e il client deve ricaricare prima di sovrascrivere.
    expected_last_modified: Optional[str] = None

# --- ENDPOINT: TUTTI GLI ESEMPI (per import in fase di compilazione) ---
@router.get("/examples/all")
def get_all_examples(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    """
    Restituisce tutti gli esempi del sistema con contesto (lingua + domanda),
    usato dal selettore di import esempi nella pagina di compilazione.
    Filtra fuori esempi con textarea vuota.
    """
    rows = db.query(
        models.Example.id,
        models.Example.textarea,
        models.Example.transliteration,
        models.Example.gloss,
        models.Example.translation,
        models.Example.reference,
        models.Answer.language_id,
        models.Answer.question_id,
        models.Language.name_full,
        models.Question.text,
        models.Question.parameter_id,
    ).join(
        models.Answer, models.Answer.id == models.Example.answer_id
    ).join(
        models.Language, models.Language.id == models.Answer.language_id
    ).join(
        models.Question, models.Question.id == models.Answer.question_id
    ).filter(
        models.Example.textarea.isnot(None),
        models.Example.textarea != ""
    ).all()

    return [{
        "id": r.id,
        "textarea": r.textarea or "",
        "transliteration": r.transliteration or "",
        "gloss": r.gloss or "",
        "translation": r.translation or "",
        "reference": r.reference or "",
        "language_id": r.language_id,
        "language_name": r.name_full,
        "question_id": r.question_id,
        "question_text": r.text or "",
        "parameter_id": r.parameter_id,
    } for r in rows]


# --- ENDPOINT: LETTURA DATI COMPILAZIONE ---
@router.get("/{lang_id}/compilation")
def get_language_compilation_data(lang_id: str, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    language = db.query(models.Language).filter(func.lower(models.Language.id) == lang_id.lower()).first()
    if not language: raise HTTPException(status_code=404, detail="Lingua non trovata")

    parameters = db.query(models.ParameterDef).filter(models.ParameterDef.is_active == True).order_by(models.ParameterDef.position).all()
    answers = db.query(models.Answer).filter(models.Answer.language_id == language.id).all()
    ans_dict = {a.question_id: a for a in answers}

    # Carica gli stati "unsure" dei parametri
    statuses = db.query(models.LanguageParameterStatus).filter(models.LanguageParameterStatus.language_id == language.id).all()
    status_dict = {s.parameter_id: s.is_unsure for s in statuses}

    result = {
        "language": {
            "id": language.id,
            "name_full": language.name_full,
            "status": language.status,
            "rejection_note": language.rejection_note,
            "submitted_at": language.submitted_at.isoformat() if language.submitted_at else None,
            "reviewed_at": language.reviewed_at.isoformat() if language.reviewed_at else None,
            "assigned_user_id": language.assigned_user_id,
        },
        "parameters": []
    }

    for p in parameters:
        active_questions = [q for q in p.questions if q.is_active]
        total_q = len(active_questions)
        answered_q = sum(1 for q in active_questions if q.id in ans_dict and ans_dict[q.id].response_text)

        # Fingerprint del blocco: MAX(updated_at) delle risposte appartenenti al parametro.
        # Usato per il check di concorrenza ottimistica al save (admin/user simultanei).
        block_last_modified = None
        for q in active_questions:
            if q.id in ans_dict:
                u = ans_dict[q.id].updated_at
                if u is not None and (block_last_modified is None or u > block_last_modified):
                    block_last_modified = u

        param_data = {
            "id": p.id,
            "name": p.name,
            "short_description": p.short_description,
            "stats": {"answered": answered_q, "total": total_q},
            "is_flagged": status_dict.get(p.id, False),
            "last_modified": block_last_modified.isoformat() if block_last_modified else None,
            "questions": []
        }
        for q in active_questions:
            q_data = {
                "id": q.id, "text": q.text, "instruction": q.instruction,
                "instruction_yes": q.instruction_yes, "instruction_no": q.instruction_no,
                "allowed_motivations": [{"id": am.motivation.id, "label": am.motivation.label} for am in q.allowed_motivations],
                "answer": None
            }
            if q.id in ans_dict:
                ans = ans_dict[q.id]
                q_data["answer"] = {
                    "response_text": ans.response_text, "comments": ans.comments,
                    "motivation_ids": [m.motivation_id for m in ans.answer_motivations],
                    "examples": [{"id": ex.id, "textarea": ex.textarea, "transliteration": ex.transliteration, "gloss": ex.gloss, "translation": ex.translation, "reference": ex.reference} for ex in ans.examples]
                }
            param_data["questions"].append(q_data)
        result["parameters"].append(param_data)
    return result

def _block_last_modified_iso(db: Session, language_id: str, param_id: str) -> Optional[str]:
    """MAX(answer.updated_at) per le risposte di questo (lingua, parametro), in ISO 8601."""
    current_max = db.query(func.max(models.Answer.updated_at)).join(
        models.Question, models.Question.id == models.Answer.question_id
    ).filter(
        models.Answer.language_id == language_id,
        models.Question.parameter_id == param_id,
    ).scalar()
    return current_max.isoformat() if current_max else None


# --- ENDPOINT: SALVATAGGIO MASSIVO PARAMETRO ---
@router.post("/{lang_id}/parameters/{param_id}/save_block")
def save_parameter_block(lang_id: str, param_id: str, payload: ParameterBlockSavePayload, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    language = db.query(models.Language).filter(func.lower(models.Language.id) == lang_id.lower()).first()
    if not language: raise HTTPException(status_code=404, detail="Lingua non trovata")
    _ensure_can_modify(language, current_user)

    # Optimistic concurrency: se il client ci dice che ha caricato il blocco a un
    # certo timestamp e nel frattempo qualcun altro l'ha modificato, rifiutiamo
    # con 409 invece di sovrascrivere il lavoro altrui.
    if payload.expected_last_modified is not None:
        current_iso = _block_last_modified_iso(db, language.id, param_id)
        if current_iso != payload.expected_last_modified:
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "stale_block",
                    "message": "Questo blocco è stato modificato da un'altra sessione (probabilmente un admin). Ricarica la pagina per vedere le modifiche prima di salvare.",
                    "current_last_modified": current_iso,
                    "expected_last_modified": payload.expected_last_modified,
                }
            )

    # 1. Aggiorna o crea il flag Unsure
    status_entry = db.query(models.LanguageParameterStatus).filter(
        models.LanguageParameterStatus.language_id == language.id,
        models.LanguageParameterStatus.parameter_id == param_id
    ).first()
    if not status_entry:
        status_entry = models.LanguageParameterStatus(language_id=language.id, parameter_id=param_id)
        db.add(status_entry)
    status_entry.is_unsure = payload.is_unsure

    # 2. Salva tutte le risposte fornite
    for ans_payload in payload.answers:
        # La colonna response_text è Enum("yes","no") nullable: "" non è valido,
        # va convertito in None per indicare "non risposta".
        normalized_response = ans_payload.response_text if ans_payload.response_text in ("yes", "no") else None

        if normalized_response == "yes":
            valid_ex_count = sum(1 for ex in ans_payload.examples if ex.textarea.strip())
            if valid_ex_count < 2:
                raise HTTPException(status_code=400, detail=f"Devi inserire almeno 2 esempi validi per la domanda {ans_payload.question_id} se rispondi YES.")

        answer = db.query(models.Answer).filter(
            models.Answer.language_id == language.id,
            models.Answer.question_id == ans_payload.question_id
        ).first()

        # Se non c'è ancora una Answer e la risposta è vuota, non creiamo righe vuote
        if not answer and normalized_response is None and not (ans_payload.comments or "").strip():
            continue

        if not answer:
            answer = models.Answer(language_id=language.id, question_id=ans_payload.question_id)
            db.add(answer)
            db.flush()

        answer.response_text = normalized_response
        answer.comments = ans_payload.comments

        # Pulisci e ricrea motivazioni/esempi
        db.query(models.AnswerMotivation).filter(models.AnswerMotivation.answer_id == answer.id).delete()
        if normalized_response == "no":
            for mid in ans_payload.motivation_ids:
                db.add(models.AnswerMotivation(answer_id=answer.id, motivation_id=mid))

        db.query(models.Example).filter(models.Example.answer_id == answer.id).delete()
        if normalized_response == "yes":
            for ex in ans_payload.examples:
                if ex.textarea.strip():
                    db.add(models.Example(answer_id=answer.id, **ex.model_dump(exclude={'id'})))

    db.commit()
    recompute_and_persist_language_parameter(language.id, param_id, db)
    db.commit()
    return {
        "detail": "Parametro salvato correttamente",
        "last_modified": _block_last_modified_iso(db, language.id, param_id)
    }

# --- WORKFLOW ENDPOINTS ---
class RejectPayload(BaseModel):
    note: Optional[str] = ""


@router.post("/{lang_id}/workflow/submit")
def submit_language(lang_id: str, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    """
    pending|rejected -> waiting_for_approval.
    SOLO l'utente assegnato può inviare. Gli admin non submittano (passano direttamente
    da approve/reject sulle lingue già in waiting_for_approval).
    """
    language = db.query(models.Language).filter(func.lower(models.Language.id) == lang_id.lower()).first()
    if not language: raise HTTPException(status_code=404, detail="Lingua non trovata")

    if current_user.role == "admin":
        raise HTTPException(status_code=403, detail="Il submit è riservato all'utente assegnato. Gli admin gestiscono via approve/reject.")
    if language.assigned_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Solo l'utente assegnato a questa lingua può inviarla.")
    if language.status not in ("pending", "rejected"):
        raise HTTPException(status_code=409, detail=f"Impossibile inviare: stato corrente '{language.status}'.")

    language.status = "waiting_for_approval"
    language.submitted_at = datetime.utcnow()
    language.rejection_note = None  # ripuliamo eventuale nota di rifiuto precedente
    db.commit()
    return {"detail": "Lingua inviata per approvazione.", "status": language.status}


@router.post("/{lang_id}/workflow/approve")
def approve_language(lang_id: str, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    """
    waiting_for_approval -> approved. Solo admin.
    """
    language = db.query(models.Language).filter(func.lower(models.Language.id) == lang_id.lower()).first()
    if not language: raise HTTPException(status_code=404, detail="Lingua non trovata")
    if language.status != "waiting_for_approval":
        raise HTTPException(status_code=409, detail=f"Impossibile approvare: stato corrente '{language.status}'.")

    language.status = "approved"
    language.reviewed_at = datetime.utcnow()
    language.rejection_note = None
    db.commit()
    return {"detail": "Lingua approvata.", "status": language.status}


@router.post("/{lang_id}/workflow/reject")
def reject_language(lang_id: str, payload: RejectPayload, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    """
    waiting_for_approval -> rejected (con nota opzionale). Solo admin.
    """
    language = db.query(models.Language).filter(func.lower(models.Language.id) == lang_id.lower()).first()
    if not language: raise HTTPException(status_code=404, detail="Lingua non trovata")
    if language.status != "waiting_for_approval":
        raise HTTPException(status_code=409, detail=f"Impossibile rifiutare: stato corrente '{language.status}'.")

    language.status = "rejected"
    language.reviewed_at = datetime.utcnow()
    language.rejection_note = (payload.note or "").strip() or None
    db.commit()
    return {"detail": "Lingua rifiutata.", "status": language.status, "rejection_note": language.rejection_note}


@router.post("/{lang_id}/workflow/reopen")
def reopen_language(lang_id: str, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    """
    rejected -> pending. Utente assegnato o admin.
    """
    language = db.query(models.Language).filter(func.lower(models.Language.id) == lang_id.lower()).first()
    if not language: raise HTTPException(status_code=404, detail="Lingua non trovata")

    if current_user.role != "admin" and language.assigned_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Non sei autorizzato a riaprire questa lingua.")
    if language.status != "rejected":
        raise HTTPException(status_code=409, detail=f"Impossibile riaprire: stato corrente '{language.status}'.")

    language.status = "pending"
    db.commit()
    return {"detail": "Lingua riaperta.", "status": language.status}


@router.get("/{lang_id}/debug")
def get_language_debug_data(lang_id: str, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    language = db.query(models.Language).filter(func.lower(models.Language.id) == lang_id.lower()).first()
    if not language: raise HTTPException(status_code=404, detail="Lingua non trovata")

    # 1. Recupera parametri attivi e relative domande
    parameters = db.query(models.ParameterDef).filter(
        models.ParameterDef.is_active == True
    ).order_by(models.ParameterDef.position, models.ParameterDef.id).all()

    # 2. Recupera risposte correnti
    answers = db.query(models.Answer).filter(models.Answer.language_id == language.id).all()
    ans_by_qid = {a.question_id: a for a in answers}

    # 3. Recupera valori originali ed eval (LanguageParameter)
    lps = db.query(models.LanguageParameter).filter(models.LanguageParameter.language_id == language.id).all()

    init_by_pid = {}
    warni_by_pid = {}
    final_by_pid = {}
    warnf_by_pid = {}
    cond_values = {} # Dizionario per valutare le condizioni in tempo reale

    for lp in lps:
        pid = lp.parameter_id
        init_by_pid[pid] = lp.value_orig or ""
        warni_by_pid[pid] = bool(lp.warning_orig)
        if lp.eval:
            final_by_pid[pid] = lp.eval.value_eval or ""
            warnf_by_pid[pid] = bool(lp.eval.warning_eval)
            cond_values[pid] = lp.eval.value_eval or lp.value_orig or ""
        else:
            final_by_pid[pid] = ""
            warnf_by_pid[pid] = False
            cond_values[pid] = lp.value_orig or ""

    # 4. Costruisci le righe per la UI
    rows = []
    for p in parameters:
        q_ids = []
        q_ans = []
        for q in p.questions:
            q_ids.append(q.id)
            a = ans_by_qid.get(q.id)
            if a and a.response_text in ("yes", "no"):
                q_ans.append(a.response_text.upper())
            else:
                q_ans.append("")

        # Calcolo in tempo reale della condizione
        cond_true = None
        if p.implicational_condition:
            try:
                cond_true = evaluate_with_parser(p.implicational_condition, cond_values)
            except Exception:
                cond_true = False

        rows.append({
            "position": p.position,
            "param_id": p.id,
            "name": p.name,
            "questions": q_ids,
            "answers": q_ans,
            "initial": init_by_pid.get(p.id, ""),
            "final": final_by_pid.get(p.id, ""),
            "warn_init": warni_by_pid.get(p.id, False),
            "warn_final": warnf_by_pid.get(p.id, False),
            "cond": p.implicational_condition or "",
            "cond_true": cond_true
        })

    return {
        "language": {"id": language.id, "name_full": language.name_full},
        "rows": rows
    }


# --- ENDPOINT: ESECUZIONE MANUALE DAG E APPROVAZIONE ---
@router.post("/{lang_id}/workflow/run_dag")
def run_dag_endpoint(lang_id: str, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    language = db.query(models.Language).filter(func.lower(models.Language.id) == lang_id.lower()).first()
    if not language: raise HTTPException(status_code=404, detail="Lingua non trovata")

    # 1. Forza l'approvazione di tutte le risposte
    db.query(models.Answer).filter(
        models.Answer.language_id == language.id,
        models.Answer.status != "approved"
    ).update({"status": "approved"})
    db.commit()

    # CRITICO: Prima di lanciare il DAG, ricalcoliamo i valori originali (value_orig)
    # per tutti i parametri attivi usando param_consolidate per essere sicuri al 100% che i dati siano freschi.
    active_params = db.query(models.ParameterDef.id).filter(models.ParameterDef.is_active == True).all()
    for (pid,) in active_params:
        recompute_and_persist_language_parameter(language.id, pid, db)
    db.commit()

    # 2. Lancia il DAG
    try:
        report = run_dag_for_language(language.id, db)
        db.commit()
        return {
            "detail": f"DAG completato. Elaborati: {len(report.processed)}, Forzati a zero: {len(report.forced_zero)}, Warning propagati: {len(report.warnings_propagated)}."
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Errore critico durante l'esecuzione del DAG: {str(e)}")