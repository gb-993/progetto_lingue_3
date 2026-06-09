from typing import Optional, List
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

import models
from dependencies import get_db, require_admin
from services.versioning import record_version
from services import archive_service
from services import question_transfer
from services.question_copy import copy_question_data
from services.recompute import recompute_parameter_for_all_languages

ID_MAX_LEN = 40  # Length(Question.id) — vincolo schema

router = APIRouter(prefix="/api/admin/questions", tags=["Questions"])

# --- SCHEMA PYDANTIC ---
class QuestionBase(BaseModel):
    id: str
    parameter_id: str
    text: str
    instruction: Optional[str] = None
    instruction_yes: Optional[str] = None
    instruction_no: Optional[str] = None
    example_yes: Optional[str] = None
    help_info: Optional[str] = None
    is_stop_question: bool = False
    is_active: bool = True
    allowed_motivations: List[int] = []

class QuestionUpdate(QuestionBase):
    change_note: Optional[str] = ""
    # Se True, prima di applicare le modifiche le Answer/Example/AnswerMotivation
    # collegate vengono spostate in archived_* (con snapshot della question
    # *vecchia*) e poi cancellate dai tavoli attivi. La question viva resta
    # con il nuovo testo e zero dati.
    wipe_data: bool = False

class QuestionCreate(QuestionBase):
    change_note: Optional[str] = ""
    # Se valorizzato, dopo aver creato la question vengono clonati tutti i dati
    # linguistici (Answer/Example/AnswerMotivation) della question sorgente
    # indicata. È il "Duplicate WITH data": la sorgente resta intatta.
    copy_data_from: Optional[str] = None

# --- ENDPOINT ---
@router.get("")
def get_admin_questions(db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    questions = (
        db.query(models.Question)
        .join(models.ParameterDef, models.Question.parameter_id == models.ParameterDef.id)
        .order_by(models.ParameterDef.position, models.Question.id)
        .all()
    )
    return questions


@router.get("/{id}")
def get_admin_question(id: str, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    question = db.query(models.Question).options(joinedload(models.Question.allowed_motivations)).filter(models.Question.id == id).first()
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    return {
        "id": question.id,
        "parameter_id": question.parameter_id,
        "text": question.text,
        "instruction": question.instruction,
        "instruction_yes": question.instruction_yes,
        "instruction_no": question.instruction_no,
        "example_yes": question.example_yes,
        "help_info": question.help_info,
        "is_stop_question": question.is_stop_question,
        "is_active": question.is_active,
        "allowed_motivations": [qm.motivation_id for qm in question.allowed_motivations]
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def create_admin_question(item: QuestionCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    param = db.query(models.ParameterDef).filter(models.ParameterDef.id == item.parameter_id).first()
    if not param:
        raise HTTPException(status_code=400, detail="The associated parameter does not exist.")

    # Duplicate WITH data: la sorgente da clonare deve esistere. La validiamo
    # qui (prima di creare la nuova question) così un id sbagliato non lascia
    # una question vuota a metà.
    if item.copy_data_from:
        source_q = db.query(models.Question).filter(models.Question.id == item.copy_data_from).first()
        if not source_q:
            raise HTTPException(status_code=400, detail="The source question to copy data from does not exist.")

    db_item = models.Question(
        id=item.id,
        parameter_id=item.parameter_id,
        text=item.text,
        instruction=item.instruction,
        instruction_yes=item.instruction_yes,
        instruction_no=item.instruction_no,
        example_yes=item.example_yes,
        help_info=item.help_info,
        is_active=item.is_active,
        is_stop_question=item.is_stop_question
    )
    db.add(db_item)
    try:
        db.commit()
        db.refresh(db_item)

        if item.allowed_motivations:
            for mot_id in item.allowed_motivations:
                db.add(models.QuestionAllowedMotivation(question_id=db_item.id, motivation_id=mot_id))

        # Duplicate WITH data: clona Answer/Example/AnswerMotivation dalla
        # sorgente. Avviene dopo il primo commit, così il FK question_id punta
        # a una question già persistita.
        copied = None
        if item.copy_data_from:
            copied = copy_question_data(db, item.copy_data_from, db_item.id)

        # Registra il log di creazione nel parametro genitore (stessa logica del PUT)
        if item.change_note and item.change_note.strip():
            note = f"[Question {item.id}] New: {item.change_note.strip()}"
            if copied:
                note += f" (data copied from {item.copy_data_from}: {copied['answers']} answers, {copied['examples']} examples)"
            log = models.ParameterChangeLog(
                parameter_id=item.parameter_id,
                user_id=current_user.id,
                change_note=note
            )
            db.add(log)

        db.commit()
        record_version(db, db_item, operation="create", source="manual",
                       user_id=current_user.id, note=(item.change_note or None))
        db.commit()

        # Se sono stati copiati dati, il consolidate del parametro cambia:
        # schedula il ricalcolo per tutte le lingue (come toggle-active).
        if copied and copied["answers"]:
            background_tasks.add_task(recompute_parameter_for_all_languages, item.parameter_id)

        return db_item
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Could not create the question. Duplicate ID.")


@router.put("/{id}")
def update_admin_question(id: str, item: QuestionUpdate, background_tasks: BackgroundTasks, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    db_item = db.query(models.Question).filter(models.Question.id == id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Question not found")

    param = db.query(models.ParameterDef).filter(models.ParameterDef.id == item.parameter_id).first()
    if not param:
        raise HTTPException(status_code=400, detail="The associated parameter does not exist.")

    # Snapshot del parameter_id prima dell'update: se cambia parent, dobbiamo
    # ricalcolare anche il parametro vecchio (oltre a quello nuovo, sempre).
    old_parameter_id = db_item.parameter_id

    # --- Rename dell'id: validazioni + gestione alias (speculare a languages) ---
    # Il DB ha ON UPDATE CASCADE su tutte le FK verso questions.id (answers,
    # question_allowed_motivations), quindi i record collegati vengono aggiornati
    # nella stessa transazione. Le tabelle storiche con question_id denormalizzato
    # senza FK (archived_questions.original_question_id, entity_versions) NON
    # seguono: per design conservano il valore al momento dell'archiviazione/log.
    new_id = (item.id or "").strip()
    if not new_id:
        raise HTTPException(status_code=422, detail="Question ID cannot be empty.")
    if len(new_id) > ID_MAX_LEN:
        raise HTTPException(
            status_code=422,
            detail=f"Question ID exceeds the {ID_MAX_LEN}-character limit.",
        )
    old_id = db_item.id
    renaming = new_id != old_id
    rename_note = None
    if renaming:
        if db.query(models.Question.id).filter(models.Question.id == new_id).first():
            raise HTTPException(status_code=409, detail=f"Question ID '{new_id}' is already in use.")
        # Il nuovo id non puo' collidere con un alias di un'altra domanda,
        # altrimenti il resolver di restore/import diventerebbe ambiguo.
        conflicting_alias = (
            db.query(models.QuestionAlias)
            .filter(
                models.QuestionAlias.old_id == new_id,
                models.QuestionAlias.question_id != old_id,
            )
            .first()
        )
        if conflicting_alias:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Question ID '{new_id}' is already used as a historical alias "
                    f"of question '{conflicting_alias.question_id}'."
                ),
            )

    # Wipe + snapshot dei dati nelle tabelle archive PRIMA di applicare le
    # modifiche (testo o rename): lo snapshot deve riflettere la versione vecchia
    # e l'archivio registra il vecchio id.
    archived_id = None
    if item.wipe_data:
        archived = archive_service.archive_and_wipe(
            db=db,
            question=db_item,
            user_id=current_user.id,
            archive_note=item.change_note or "",
        )
        archived_id = archived.id

    if renaming:
        # Se il nuovo id era un alias di QUESTA stessa domanda (rename A->B->A),
        # rimuovi quell'alias adesso: tra poco l'id ridiventa "corrente".
        db.query(models.QuestionAlias).filter(
            models.QuestionAlias.old_id == new_id,
            models.QuestionAlias.question_id == old_id,
        ).delete(synchronize_session=False)
        # Applica il rename PRIMA di registrare l'alias: la cascade DB sposta
        # answers/question_allowed_motivations sul nuovo id nella stessa
        # transazione, ed evitiamo dipendenze sull'ordine di flush.
        db_item.id = new_id
        db.flush()
        existing_alias = (
            db.query(models.QuestionAlias)
            .filter(models.QuestionAlias.old_id == old_id)
            .first()
        )
        if existing_alias is None:
            db.add(models.QuestionAlias(question_id=new_id, old_id=old_id))
        rename_note = f"Renamed from {old_id} to {new_id}"
    else:
        db_item.id = new_id

    db_item.parameter_id = item.parameter_id
    db_item.text = item.text
    db_item.instruction = item.instruction
    db_item.instruction_yes = item.instruction_yes
    db_item.instruction_no = item.instruction_no
    db_item.example_yes = item.example_yes
    db_item.help_info = item.help_info
    db_item.is_stop_question = item.is_stop_question
    db_item.is_active = item.is_active

    db.query(models.QuestionAllowedMotivation).filter(models.QuestionAllowedMotivation.question_id == db_item.id).delete()

    for mot_id in item.allowed_motivations:
        db.add(models.QuestionAllowedMotivation(question_id=db_item.id, motivation_id=mot_id))

    # Registra il log di modifica nel parametro genitore (segna anche rename/wipe).
    note_parts = []
    if item.change_note and item.change_note.strip():
        note_parts.append(item.change_note.strip())
    if renaming:
        note_parts.append(f"[Renamed {old_id} -> {new_id}]")
    if item.wipe_data:
        note_parts.append("[Linked data archived]")
    if note_parts:
        log = models.ParameterChangeLog(
            parameter_id=item.parameter_id,
            user_id=current_user.id,
            change_note=f"[Question {new_id}] {' '.join(note_parts)}"
        )
        db.add(log)

    try:
        db.commit()
        record_version(db, db_item, operation="update", source="manual",
                       user_id=current_user.id, note=(rename_note or item.change_note or None))
        db.commit()

        # Recompute sempre per il parametro corrente (qualunque modifica alla
        # question, anche solo cosmetica, scatena il ricalcolo). Se la question
        # ha cambiato parent, ricalcoliamo anche il vecchio parametro.
        impacted_param_ids = {item.parameter_id}
        if old_parameter_id and old_parameter_id != item.parameter_id:
            impacted_param_ids.add(old_parameter_id)
        for pid in impacted_param_ids:
            background_tasks.add_task(recompute_parameter_for_all_languages, pid)

        return {
            "detail": "Question updated successfully",
            "archived_question_id": archived_id,
        }
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Could not update the question.")


@router.get("/{id}/data-stats")
def get_question_data_stats(
    id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    """Quante Answer/Example/lingue sono collegate alla question.

    Usato dal frontend per mostrare il preview prima del wipe.
    """
    if not db.query(models.Question.id).filter(models.Question.id == id).first():
        raise HTTPException(status_code=404, detail="Question not found")
    return archive_service.count_linked_data(db, id)


# --- TRASFERIMENTO DATI VERSO UN'ALTRA QUESTION ---
class TransferDataPayload(BaseModel):
    dest_id: str
    # Lingue (id) per cui, in caso di conflitto, si sovrascrive la destinazione
    # con la sorgente. Le lingue in conflitto NON elencate qui mantengono la
    # risposta gia' presente nella destinazione.
    overwrite_language_ids: List[str] = []
    change_note: Optional[str] = ""


@router.get("/{id}/transfer-preview")
def get_transfer_preview(
    id: str,
    dest_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    """Preview dei conflitti per il trasferimento dati da `id` a `dest_id`.

    Ritorna quante lingue verrebbero spostate direttamente e l'elenco di quelle
    in conflitto (destinazione gia' valorizzata) con un riassunto delle risposte.
    """
    source = db.query(models.Question).filter(models.Question.id == id).first()
    if not source:
        raise HTTPException(status_code=404, detail="Question not found")
    dest = db.query(models.Question).filter(models.Question.id == dest_id).first()
    if not dest:
        raise HTTPException(status_code=400, detail="Destination question not found.")
    if source.id == dest.id:
        raise HTTPException(status_code=400, detail="Source and destination must be different questions.")
    return question_transfer.preview_transfer_conflicts(db, source.id, dest.id)


@router.post("/{id}/transfer-data")
def transfer_question_data_endpoint(
    id: str,
    payload: TransferDataPayload,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    """Sposta tutti i dati linguistici della question `id` sulla `dest_id`.

    Prima archivia uno snapshot di sicurezza della sorgente (Old Questions
    Archive), poi sposta/risolve i conflitti per-lingua. La question sorgente
    resta viva ma senza dati. Ricalcola i parametri coinvolti in background.
    """
    source = db.query(models.Question).filter(models.Question.id == id).first()
    if not source:
        raise HTTPException(status_code=404, detail="Question not found")
    dest = db.query(models.Question).filter(models.Question.id == payload.dest_id).first()
    if not dest:
        raise HTTPException(status_code=400, detail="Destination question not found.")
    if source.id == dest.id:
        raise HTTPException(status_code=400, detail="Source and destination must be different questions.")

    note = (payload.change_note or "").strip()

    # 1. Snapshot di sicurezza della sorgente (prima di spostare/cancellare).
    archived = archive_service.snapshot_question_data(
        db, source, current_user.id,
        archive_note=note or f"Data transferred to {dest.id}",
    )

    # 2. Sposta i dati risolvendo i conflitti per-lingua.
    result = question_transfer.transfer_question_data(
        db, source.id, dest.id, set(payload.overwrite_language_ids or []),
    )

    # 3. Log sul parametro sorgente (e su quello destinazione, se diverso).
    src_param = source.parameter_id
    dst_param = dest.parameter_id
    suffix = f" Note: {note}" if note else ""
    db.add(models.ParameterChangeLog(
        parameter_id=src_param,
        user_id=current_user.id,
        change_note=(
            f"[Question {source.id}] Data transferred to {dest.id} "
            f"(moved {result['moved']}, overwritten {result['overwritten']}, "
            f"kept {result['kept']}); snapshot archived.{suffix}"
        ),
    ))
    if dst_param != src_param:
        db.add(models.ParameterChangeLog(
            parameter_id=dst_param,
            user_id=current_user.id,
            change_note=(
                f"[Question {dest.id}] Received data from {source.id} "
                f"(moved {result['moved']}, overwritten {result['overwritten']}).{suffix}"
            ),
        ))

    db.commit()

    # 4. Ricalcolo dei parametri coinvolti (consolidate + DAG) in background.
    background_tasks.add_task(recompute_parameter_for_all_languages, src_param)
    if dst_param != src_param:
        background_tasks.add_task(recompute_parameter_for_all_languages, dst_param)

    return {
        "detail": "Data transferred successfully",
        "archived_question_id": archived.id,
        **result,
    }


@router.patch("/{id}/toggle-active")
def toggle_question_active(id: str, background_tasks: BackgroundTasks, db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    """Disattiva o riattiva una domanda senza eliminarla dal DB"""
    db_item = db.query(models.Question).filter(models.Question.id == id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Question not found")

    db_item.is_active = not db_item.is_active
    parameter_id = db_item.parameter_id

    # Logga automaticamente l'azione sul parametro
    azione = "Reactivated" if db_item.is_active else "Deactivated"
    log = models.ParameterChangeLog(
        parameter_id=parameter_id,
        user_id=current_user.id,
        change_note=f"[Question {id}] {azione}"
    )
    db.add(log)

    db.commit()
    record_version(db, db_item, operation="update", source="manual",
                   user_id=current_user.id, note=azione)
    db.commit()

    # Cambiare is_active fa cambiare il consolidate del parametro padre, e di
    # conseguenza il DAG: schedula il ricalcolo per tutte le lingue.
    background_tasks.add_task(recompute_parameter_for_all_languages, parameter_id)

    return {"detail": "Question status updated", "is_active": db_item.is_active}
