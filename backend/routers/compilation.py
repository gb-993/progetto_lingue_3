import logging
from typing import List, Optional, Dict
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from time_utils import utc_now
from pydantic import BaseModel
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import func, or_
import models
from database import SessionLocal
from dependencies import get_db, get_current_user, require_admin, require_super_admin
from services.logic_parser import evaluate_with_parser
from services.dag_eval import run_dag_for_language
from services.param_consolidate import recompute_and_persist_language_parameter
from services.versioning import record_version, serialize_entity
from services.param_state import param_color, language_completion_from_colors

logger = logging.getLogger(__name__)


def _run_dag_in_background(language_id: str) -> None:
    """Esegue run_dag_for_language su una sessione DB dedicata.

    La dependency `db` di FastAPI viene chiusa appena la response parte, quindi i
    BackgroundTasks devono aprirsi una loro sessione. Errori loggati ma mai
    propagati (il task gira fuori dal ciclo request/response).
    """
    db = SessionLocal()
    try:
        run_dag_for_language(language_id, db)
        db.commit()
    except Exception as e:
        db.rollback()
        logger.error("DAG background run failed for language %s: %s", language_id, e, exc_info=True)
    finally:
        db.close()


def _ensure_can_modify(language: models.Language, current_user: models.User):
    """
    Permessi di modifica (asse B):
      - admin: SEMPRE, a prescindere dallo status (anche submitted/validated:
        l'admin può sempre fixare/editare, senza dover prima riaprire).
      - utente assegnato: solo in 'draft' (bloccato su submitted/validated).
      - chiunque altro: 403.
    """
    if current_user.role == "admin":
        return
    if language.assigned_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="You are not authorized to modify this language.")
    if language.status != "draft":
        raise HTTPException(
            status_code=409,
            detail=f"Language locked (status: {language.status}). Wait for the admin review.",
        )


router = APIRouter(prefix="/api/languages", tags=["Compilation & Workflow"])

# --- SCHEMI PYDANTIC ---
class ExampleInput(BaseModel):
    id: Optional[int] = None
    number: str = ""
    textarea: str = ""
    transliteration: str = ""
    gloss: str = ""
    translation: str = ""
    reference: str = ""
    # Esempio "di test"/segnaposto. Solo gli admin possono settarlo: per i
    # non-admin il valore in arrivo viene ignorato (forzato a False) al salvataggio.
    is_test: bool = False

class QuestionAnswerPayload(BaseModel):
    question_id: str
    response_text: str
    comments: str = ""
    motivation_ids: List[int] = []
    examples: List[ExampleInput] = []

class ParameterBlockSavePayload(BaseModel):
    answers: List[QuestionAnswerPayload]
    is_unsure: bool
    # Nota libera admin-only per (lingua, parametro). None = non passare in update;
    # stringa vuota = svuotare la nota. Ignorata per utenti non admin.
    admin_note: Optional[str] = None
    # Timestamp del blocco visto dal client al caricamento (ISO 8601). Se al save
    # il MAX(updated_at) corrente è diverso, qualcun altro ha modificato nel mentre:
    # rispondiamo 409 e il client deve ricaricare prima di sovrascrivere.
    expected_last_modified: Optional[str] = None

# --- ENDPOINT: RICERCA ESEMPI (per import in fase di compilazione) ---
@router.get("/examples/search")
def search_examples(
    q: str = "",
    language_id: Optional[str] = None,
    limit: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Ricerca esempi per il selettore di import della pagina di compilazione.

    Filtro per lingua:
      - language_id presente → ricerca SEMPRE ristretta a quella lingua, sia con
        q vuota sia con q valorizzata. Un esempio linguistico non si ripete tra
        lingue diverse, quindi gli esempi di altre lingue sarebbero rumore.
      - language_id assente → ricerca globale (caso non usato dal frontend, ma
        supportato; qui il limit di 200 fa da safety net per evitare payload enormi).

    Filtri:
      - q: full-text ILIKE su textarea/translation/gloss (case-insensitive)
      - limit: se language_id è presente, nessun limite di default (mostra tutti
        gli esempi della lingua). Se language_id è assente, clamp a [1, 200].
    """
    base = db.query(
        models.Example.id,
        models.Example.textarea,
        models.Example.transliteration,
        models.Example.gloss,
        models.Example.translation,
        models.Example.reference,
        models.Answer.language_id,
        models.Answer.question_id,
        models.Language.name_full,
    ).join(
        models.Answer, models.Answer.id == models.Example.answer_id
    ).join(
        models.Language, models.Language.id == models.Answer.language_id
    ).filter(
        models.Example.textarea.isnot(None),
        models.Example.textarea != "",
    )

    if language_id:
        base = base.filter(models.Answer.language_id == language_id)

    q = (q or "").strip()
    if q:
        like = f"%{q}%"
        base = base.filter(or_(
            models.Example.textarea.ilike(like),
            models.Example.translation.ilike(like),
            models.Example.gloss.ilike(like),
        ))

    base = base.order_by(func.lower(models.Language.id), models.Example.id)

    if language_id:
        if limit is not None:
            base = base.limit(max(1, int(limit)))
    else:
        effective_limit = max(1, min(int(limit or 50), 200))
        base = base.limit(effective_limit)

    rows = base.all()

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
    } for r in rows]


# --- ENDPOINT: LETTURA DATI COMPILAZIONE ---
@router.get("/{lang_id}/compilation")
def get_language_compilation_data(lang_id: str, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    language = db.query(models.Language).filter(models.Language.id == lang_id).first()
    if not language: raise HTTPException(status_code=404, detail="Language not found")

    parameters = (
        db.query(models.ParameterDef)
        .filter(models.ParameterDef.is_active == True)
        .order_by(models.ParameterDef.position)
        .options(
            selectinload(models.ParameterDef.questions)
            .selectinload(models.Question.allowed_motivations)
            .selectinload(models.QuestionAllowedMotivation.motivation)
        )
        .all()
    )
    answers = (
        db.query(models.Answer)
        .filter(models.Answer.language_id == language.id)
        .options(
            selectinload(models.Answer.answer_motivations),
            selectinload(models.Answer.examples),
        )
        .all()
    )
    ans_dict = {a.question_id: a for a in answers}

    # Carica gli stati "unsure" dei parametri (e admin_note solo per admin)
    statuses = db.query(models.LanguageParameterStatus).filter(models.LanguageParameterStatus.language_id == language.id).all()
    status_dict = {s.parameter_id: s.is_unsure for s in statuses}
    needs_review_dict = {s.parameter_id: bool(s.needs_review) for s in statuses}
    is_admin = current_user.role == "admin"
    admin_note_dict = {s.parameter_id: (s.admin_note or "") for s in statuses} if is_admin else {}

    result = {
        "language": {
            "id": language.id,
            "name_full": language.name_full,
            "status": language.status,
            "rejection_note": language.rejection_note,
            "submitted_at": language.submitted_at.isoformat() if language.submitted_at else None,
            "reviewed_at": language.reviewed_at.isoformat() if language.reviewed_at else None,
            "assigned_user_id": language.assigned_user_id,
            "assigned_user": (
                {
                    "id": language.assigned_user.id,
                    "name": language.assigned_user.name,
                    "surname": language.assigned_user.surname,
                }
                if language.assigned_user else None
            ),
            "top_level_family": language.top_level_family,
            "family": language.family,
            "grp": language.grp,
            "historical_language": language.historical_language,
            "isocode": language.isocode,
            "glottocode": language.glottocode,
            "location": language.location,
            "latitude": float(language.latitude) if language.latitude is not None else None,
            "longitude": float(language.longitude) if language.longitude is not None else None,
            "supervisor": language.supervisor,
            "informant": language.informant,
            "source": language.source,
            # Asse A: override manuale (super-admin) del completamento, o None.
            "completion_override": language.completion_override,
        },
        "parameters": []
    }

    # Colori dei parametri "rispondibili" (con almeno una question attiva), per
    # calcolare il completamento della lingua (asse A) dopo il loop.
    answerable_colors: list[str] = []

    for p in parameters:
        # Ordine deterministico: prima le question regolari per id, poi le
        # stop-question per id. Coerente con la pagina debug admin (vedi sotto)
        # e indipendente dall'ordine fisico delle righe in Postgres.
        active_questions = sorted(
            (q for q in p.questions if q.is_active),
            key=lambda x: (x.is_stop_question, x.id),
        )
        total_q = len(active_questions)
        # 'unsure' non conta come risposta completata: il parametro resta colorato
        # come "vuoto" anche dopo il save, esattamente come una selezione vuota.
        answered_q = sum(
            1 for q in active_questions
            if q.id in ans_dict and ans_dict[q.id].response_text in ("yes", "no")
        )

        # Fingerprint del blocco: MAX(updated_at) delle risposte appartenenti al parametro.
        # Usato per il check di concorrenza ottimistica al save (admin/user simultanei).
        block_last_modified = None
        for q in active_questions:
            if q.id in ans_dict:
                u = ans_dict[q.id].updated_at
                if u is not None and (block_last_modified is None or u > block_last_modified):
                    block_last_modified = u

        # Colore del quadratino (grey/red/yellow/green). Calcolato dai dati
        # correnti + il flag needs_review. is_flagged (unsure di parametro) NON
        # entra nel colore: resta solo come dato informativo.
        qids = [q.id for q in active_questions]
        response_by_qid = {
            q.id: (ans_dict[q.id].response_text if q.id in ans_dict else None)
            for q in active_questions
        }
        example_count_by_qid = {}
        has_test_example = False
        for q in active_questions:
            if q.id in ans_dict:
                exs = ans_dict[q.id].examples
                example_count_by_qid[q.id] = sum(1 for ex in exs if (ex.textarea or "").strip())
                if any(ex.is_test for ex in exs):
                    has_test_example = True
        color = param_color(
            qids, response_by_qid, example_count_by_qid,
            has_test_example, needs_review_dict.get(p.id, False),
        )
        if total_q > 0:
            answerable_colors.append(color)

        param_data = {
            "id": p.id,
            "name": p.name,
            "short_description": p.short_description,
            "stats": {"answered": answered_q, "total": total_q},
            "is_flagged": status_dict.get(p.id, False),
            "color": color,
            # True se una question del parametro ha subito una modifica seria:
            # il quadratino è giallo "da ricontrollare" finché non si ri-salva.
            "needs_review": needs_review_dict.get(p.id, False),
            "last_modified": block_last_modified.isoformat() if block_last_modified else None,
            "questions": []
        }
        if is_admin:
            param_data["admin_note"] = admin_note_dict.get(p.id, "")
        for q in active_questions:
            q_data = {
                "id": q.id, "text": q.text, "instruction": q.instruction,
                "instruction_yes": q.instruction_yes, "instruction_no": q.instruction_no,
                "example_yes": q.example_yes, "help_info": q.help_info,
                "allowed_motivations": [{"id": am.motivation.id, "label": am.motivation.label} for am in q.allowed_motivations],
                "answer": None
            }
            if q.id in ans_dict:
                ans = ans_dict[q.id]
                q_data["answer"] = {
                    "response_text": ans.response_text or "",
                    "comments": ans.comments or "",
                    "motivation_ids": [m.motivation_id for m in ans.answer_motivations],
                    # Ordine per id = ordine di inserimento. Al save gli esempi
                    # vengono cancellati e ricreati nell'ordine inviato dal client,
                    # quindi gli id crescenti riflettono il riordino fatto in UI
                    # (frecce su/giù): ordinando per id qui l'ordine resiste al refresh.
                    "examples": [{
                        "id": ex.id,
                        "number": ex.number or "",
                        "textarea": ex.textarea or "",
                        "transliteration": ex.transliteration or "",
                        "gloss": ex.gloss or "",
                        "translation": ex.translation or "",
                        "reference": ex.reference or "",
                        "is_test": bool(ex.is_test),
                    } for ex in sorted(ans.examples, key=lambda e: e.id)]
                }
            param_data["questions"].append(q_data)
        result["parameters"].append(param_data)

    # Completamento della lingua (asse A): override super-admin se presente,
    # altrimenti calcolato dai colori dei parametri rispondibili.
    result["language"]["completion"] = (
        language.completion_override
        or language_completion_from_colors(answerable_colors)
    )
    return result


@router.get("/{lang_id}/parameters/{param_id}/block")
def get_param_block_for_language(
    lang_id: str,
    param_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    """Dati di compilazione di UN parametro per UNA lingua, nello stesso formato
    del singolo blocco prodotto da `get_language_compilation_data`.

    Serve la pagina admin "parametro → tutte le lingue": il blocco viene caricato
    solo quando una riga-lingua viene espansa, così la lista resta leggera. Il
    salvataggio riusa l'endpoint esistente `save_block` (con tutta la sua logica
    di concorrenza ottimistica, validazione esempi e ricalcolo DAG). Admin-only:
    l'admin può editare a prescindere dallo status della lingua e il salvataggio
    non cambia lo status (coerente con l'override admin della pagina lingua).
    """
    language = db.query(models.Language).filter(models.Language.id == lang_id).first()
    if not language:
        raise HTTPException(status_code=404, detail="Language not found")
    parameter = (
        db.query(models.ParameterDef)
        .filter(models.ParameterDef.id == param_id)
        .options(
            selectinload(models.ParameterDef.questions)
            .selectinload(models.Question.allowed_motivations)
            .selectinload(models.QuestionAllowedMotivation.motivation)
        )
        .first()
    )
    if not parameter:
        raise HTTPException(status_code=404, detail="Parameter not found")

    # Stesso ordinamento deterministico del reader principale.
    active_questions = sorted(
        (q for q in parameter.questions if q.is_active),
        key=lambda x: (x.is_stop_question, x.id),
    )
    qids = [q.id for q in active_questions]
    answers = []
    if qids:
        answers = (
            db.query(models.Answer)
            .filter(
                models.Answer.language_id == language.id,
                models.Answer.question_id.in_(qids),
            )
            .options(
                selectinload(models.Answer.answer_motivations),
                selectinload(models.Answer.examples),
            )
            .all()
        )
    ans_dict = {a.question_id: a for a in answers}

    status_entry = db.query(models.LanguageParameterStatus).filter(
        models.LanguageParameterStatus.language_id == language.id,
        models.LanguageParameterStatus.parameter_id == param_id,
    ).first()
    is_unsure = status_entry.is_unsure if status_entry else False
    admin_note = (status_entry.admin_note or "") if status_entry else ""

    # Fingerprint del blocco = MAX(updated_at) delle risposte del parametro.
    block_last_modified = None
    for q in active_questions:
        a = ans_dict.get(q.id)
        if a is not None and a.updated_at is not None:
            if block_last_modified is None or a.updated_at > block_last_modified:
                block_last_modified = a.updated_at

    param_data = {
        "id": parameter.id,
        "name": parameter.name,
        "short_description": parameter.short_description,
        "is_flagged": is_unsure,
        "admin_note": admin_note,
        "last_modified": block_last_modified.isoformat() if block_last_modified else None,
        "questions": [],
    }
    for q in active_questions:
        q_data = {
            "id": q.id, "text": q.text, "instruction": q.instruction,
            "instruction_yes": q.instruction_yes, "instruction_no": q.instruction_no,
            "example_yes": q.example_yes, "help_info": q.help_info,
            "allowed_motivations": [{"id": am.motivation.id, "label": am.motivation.label} for am in q.allowed_motivations],
            "answer": None,
        }
        if q.id in ans_dict:
            ans = ans_dict[q.id]
            q_data["answer"] = {
                "response_text": ans.response_text or "",
                "comments": ans.comments or "",
                "motivation_ids": [m.motivation_id for m in ans.answer_motivations],
                "examples": [{
                    "id": ex.id,
                    "number": ex.number or "",
                    "textarea": ex.textarea or "",
                    "transliteration": ex.transliteration or "",
                    "gloss": ex.gloss or "",
                    "translation": ex.translation or "",
                    "reference": ex.reference or "",
                    "is_test": bool(ex.is_test),
                } for ex in sorted(ans.examples, key=lambda e: e.id)]
            }
        param_data["questions"].append(q_data)

    return {
        "language": {
            "id": language.id,
            "name_full": language.name_full,
            "status": language.status,
        },
        "parameter": param_data,
    }


def _block_last_modified_iso(db: Session, language_id: str, param_id: str) -> Optional[str]:
    """MAX(answer.updated_at) per le risposte di questo (lingua, parametro), in ISO 8601.

    SOLO question attive: il blocco mostra ed edita unicamente le question attive,
    quindi il fingerprint di concorrenza deve essere calcolato sullo stesso insieme
    del reader (get_language_compilation_data). Senza il filtro is_active, la
    risposta di una question disattivata di recente resterebbe nel MAX lato-save ma
    non lato-lettura: il confronto fallirebbe SEMPRE con un 409 fasullo, impedendo
    di salvare le altre question del parametro.
    """
    current_max = db.query(func.max(models.Answer.updated_at)).join(
        models.Question, models.Question.id == models.Answer.question_id
    ).filter(
        models.Answer.language_id == language_id,
        models.Question.parameter_id == param_id,
        models.Question.is_active == True,
    ).scalar()
    return current_max.isoformat() if current_max else None


# --- ENDPOINT: SALVATAGGIO MASSIVO PARAMETRO ---
@router.post("/{lang_id}/parameters/{param_id}/save_block")
def save_parameter_block(lang_id: str, param_id: str, payload: ParameterBlockSavePayload, background_tasks: BackgroundTasks, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    # Lock pessimistico sulla Language: serializza due save_block concorrenti sulla
    # stessa lingua. L'optimistic check sotto resta come barriera primaria
    # (e dà 409 con UX chiara), questo lock chiude la finestra di TOCTOU
    # tra il check e l'UPDATE delle Answer. Coerente con dag_eval / param_consolidate.
    language = db.query(models.Language).with_for_update().filter(models.Language.id == lang_id).first()
    if not language: raise HTTPException(status_code=404, detail="Language not found")
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
                    "message": "This block has been modified by another session (probably an admin). Reload the page to see the changes before saving.",
                    "current_last_modified": current_iso,
                    "expected_last_modified": payload.expected_last_modified,
                }
            )

    # 1. Aggiorna o crea il flag Unsure (e admin_note se admin)
    status_entry = db.query(models.LanguageParameterStatus).filter(
        models.LanguageParameterStatus.language_id == language.id,
        models.LanguageParameterStatus.parameter_id == param_id
    ).first()
    if not status_entry:
        status_entry = models.LanguageParameterStatus(language_id=language.id, parameter_id=param_id)
        db.add(status_entry)
    status_entry.is_unsure = payload.is_unsure
    # Ri-salvare il parametro = "l'ho ricontrollato": spegne il giallo "da
    # ricontrollare" eventualmente acceso da una modifica seria a una question.
    status_entry.needs_review = False
    # admin_note: solo per admin e solo se il client lo passa esplicitamente
    if current_user.role == "admin" and payload.admin_note is not None:
        note = payload.admin_note.strip()
        status_entry.admin_note = note or None

    # 2. Salva tutte le risposte fornite. Per ogni risposta toccata teniamo
    #    traccia di (answer, was_new, old_snapshot) così a fine ciclo possiamo
    #    registrare una EntityVersion solo per quelle effettivamente cambiate.
    touched: list[tuple[models.Answer, bool, Optional[dict]]] = []

    for ans_payload in payload.answers:
        # La colonna response_text è Enum("yes","no","unsure","missing") nullable: "" non è
        # valido, va convertito in None per indicare "non risposta".
        normalized_response = ans_payload.response_text if ans_payload.response_text in ("yes", "no", "unsure", "missing") else None

        # 'unsure' eredita da 'yes' il vincolo "almeno 2 esempi", perché anche
        # quando l'utente è incerto deve documentare con esempi reali. 'missing'
        # invece NON richiede esempi (dato genuinamente non disponibile).
        if normalized_response in ("yes", "unsure"):
            valid_ex_count = sum(1 for ex in ans_payload.examples if ex.textarea.strip())
            if valid_ex_count < 2:
                # detail strutturato: il frontend usa `question_id` per scrollare
                # alla card della question incriminata e applicarle un bordo rosso.
                raise HTTPException(status_code=400, detail={
                    "code": "missing_examples",
                    "question_id": ans_payload.question_id,
                    "message": f"Question {ans_payload.question_id} needs at least 2 valid examples when answering YES or UNSURE.",
                })

        answer = db.query(models.Answer).filter(
            models.Answer.language_id == language.id,
            models.Answer.question_id == ans_payload.question_id
        ).first()

        # Se non c'è ancora una Answer e la risposta è vuota, non creiamo righe vuote
        if not answer and normalized_response is None and not (ans_payload.comments or "").strip():
            continue

        was_new = answer is None
        old_snapshot = None if was_new else serialize_entity(answer)

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
        # Esempi salvabili per yes/no/unsure/missing: yes/unsure li richiedono
        # (≥2, validato sopra), per 'no'/'missing' sono facoltativi ma vanno
        # comunque persistiti se il linguista li fornisce a supporto della risposta.
        if normalized_response in ("yes", "no", "unsure", "missing"):
            for ex in ans_payload.examples:
                if ex.textarea.strip():
                    # is_test arriva dal payload: lo settano solo gli admin (la
                    # checkbox è admin-only in UI); i non-admin fanno round-trip
                    # del valore esistente senza poterlo cambiare.
                    db.add(models.Example(answer_id=answer.id, **ex.model_dump(exclude={'id'})))

        touched.append((answer, was_new, old_snapshot))

    # Flush per allineare DB; poi expire delle relazioni così serialize_entity
    # rilegge la collection examples/motivations attuale e non quella in cache.
    db.flush()
    for answer, _, _ in touched:
        db.expire(answer)

    for answer, was_new, old_snapshot in touched:
        new_snapshot = serialize_entity(answer)
        if was_new or new_snapshot != old_snapshot:
            record_version(
                db, answer,
                operation="create" if was_new else "update",
                source="manual",
                user_id=current_user.id,
            )

    db.commit()
    recompute_and_persist_language_parameter(language.id, param_id, db)
    db.commit()

    # DAG auto-run: schedulato come BackgroundTask, parte dopo che la response
    # è stata inviata al client. value_eval/warning_eval di TableA/Queries
    # restano stale per ~1-2s, accettabile. Errori loggati nel task stesso.
    background_tasks.add_task(_run_dag_in_background, language.id)

    return {
        "detail": "Parameter saved successfully",
        "last_modified": _block_last_modified_iso(db, language.id, param_id)
    }


# --- WORKFLOW ENDPOINTS (asse B: draft → submitted → validated) ---
class NotePayload(BaseModel):
    note: Optional[str] = ""


@router.post("/{lang_id}/workflow/submit")
def submit_language(lang_id: str, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    """
    draft -> submitted. SOLO l'utente assegnato conferma la compilazione. Da quel
    momento la lingua è bloccata per l'utente e l'admin può iniziare la review.
    """
    language = db.query(models.Language).filter(models.Language.id == lang_id).first()
    if not language: raise HTTPException(status_code=404, detail="Language not found")

    if current_user.role == "admin":
        raise HTTPException(status_code=403, detail="Confirm is reserved for the assigned user. Admins validate or send back.")
    if language.assigned_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the user assigned to this language can confirm it.")
    if language.status != "draft":
        raise HTTPException(status_code=409, detail=f"Cannot confirm: current status '{language.status}'.")

    language.status = "submitted"
    language.submitted_at = utc_now()
    language.rejection_note = None  # ripuliamo eventuale nota di rimando precedente
    db.commit()
    return {"detail": "Language confirmed and submitted for review.", "status": language.status}


@router.post("/{lang_id}/workflow/validate")
def validate_language(
    lang_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    """
    submitted -> validated. Tutti gli admin. Esegue il DAG in background (come il
    vecchio approve). La lingua diventa sola lettura per tutti finché non si riapre.
    """
    language = db.query(models.Language).filter(models.Language.id == lang_id).first()
    if not language: raise HTTPException(status_code=404, detail="Language not found")
    if language.status != "submitted":
        raise HTTPException(status_code=409, detail=f"Cannot validate: current status '{language.status}'.")

    language.status = "validated"
    language.reviewed_at = utc_now()
    language.rejection_note = None
    db.commit()
    background_tasks.add_task(_run_dag_in_background, language.id)
    return {"detail": "Language validated.", "status": language.status}


@router.post("/{lang_id}/workflow/send_back")
def send_back_language(lang_id: str, payload: NotePayload, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    """
    submitted -> draft (con nota opzionale per l'utente). Tutti gli admin. È il
    "rimanda indietro": l'utente può ricominciare la compilazione.
    """
    language = db.query(models.Language).filter(models.Language.id == lang_id).first()
    if not language: raise HTTPException(status_code=404, detail="Language not found")
    if language.status != "submitted":
        raise HTTPException(status_code=409, detail=f"Cannot send back: current status '{language.status}'.")

    language.status = "draft"
    language.reviewed_at = utc_now()
    language.rejection_note = (payload.note or "").strip() or None
    db.commit()
    return {"detail": "Language sent back to the user.", "status": language.status, "rejection_note": language.rejection_note}


@router.post("/{lang_id}/workflow/reopen")
def reopen_language(lang_id: str, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    """
    validated -> draft. Solo admin. Sblocca una lingua già validata per poterla
    modificare di nuovo (esce dalla sola lettura).
    """
    language = db.query(models.Language).filter(models.Language.id == lang_id).first()
    if not language: raise HTTPException(status_code=404, detail="Language not found")
    if language.status != "validated":
        raise HTTPException(status_code=409, detail=f"Cannot reopen: current status '{language.status}'.")

    language.status = "draft"
    language.rejection_note = None
    db.commit()
    return {"detail": "Language reopened.", "status": language.status}


# --- ASSE A: override manuale del completamento (solo super-admin) ---
class CompletionOverridePayload(BaseModel):
    # 'empty' | 'incomplete' | 'complete' | None (None = torna al calcolo automatico)
    override: Optional[str] = None


_COMPLETION_VALUES = ("empty", "incomplete", "complete")


@router.put("/{lang_id}/completion-override")
def set_completion_override(
    lang_id: str,
    payload: CompletionOverridePayload,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_super_admin),
):
    """
    Forza (o azzera) il completamento della lingua (asse A). Riservato al
    SUPER-ADMIN. override=None rimette il completamento in automatico.
    """
    language = db.query(models.Language).filter(models.Language.id == lang_id).first()
    if not language: raise HTTPException(status_code=404, detail="Language not found")

    ov = (payload.override or "").strip().lower() or None
    if ov is not None and ov not in _COMPLETION_VALUES:
        raise HTTPException(status_code=422, detail=f"Invalid override '{payload.override}'.")

    language.completion_override = ov
    db.commit()
    return {"detail": "Completion override updated.", "completion_override": language.completion_override}


@router.get("/{lang_id}/debug")
def get_language_debug_data(lang_id: str, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    language = db.query(models.Language).filter(models.Language.id == lang_id).first()
    if not language: raise HTTPException(status_code=404, detail="Language not found")

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
    # Le question vengono restituite tutte (anche le inactive) con flag is_active:
    # è il frontend a decidere se mostrarle (checkbox "Show inactive", default off).
    # I valori init/final arrivano da LanguageParameter, già coerenti col fix di
    # consolidate (le inactive non concorrono al value_orig).
    rows = []
    for p in parameters:
        q_list = []
        for q in sorted(p.questions, key=lambda x: (x.is_stop_question, x.id)):
            a = ans_by_qid.get(q.id)
            ans_label = a.response_text.upper() if (a and a.response_text in ("yes", "no")) else ""
            q_list.append({
                "id": q.id,
                "answer": ans_label,
                "is_active": bool(q.is_active),
            })

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
            "questions": q_list,
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
    """
    Esecuzione manuale del DAG: ricalcola value_orig (consolidate) e value_eval
    (DAG implicazionale) per tutti i parametri attivi della lingua.
    Non tocca lo status della lingua né delle answer.
    """
    language = db.query(models.Language).filter(models.Language.id == lang_id).first()
    if not language: raise HTTPException(status_code=404, detail="Language not found")

    active_params = db.query(models.ParameterDef.id).filter(models.ParameterDef.is_active == True).all()
    for (pid,) in active_params:
        recompute_and_persist_language_parameter(language.id, pid, db)
    db.commit()

    try:
        report = run_dag_for_language(language.id, db)
        db.commit()
        return {
            "detail": f"DAG completed. Processed: {len(report.processed)}, Forced to zero: {len(report.forced_zero)}, Warnings propagated: {len(report.warnings_propagated)}."
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Critical error while running the DAG: {str(e)}")