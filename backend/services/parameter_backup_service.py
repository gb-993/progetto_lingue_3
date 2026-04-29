from sqlalchemy.orm import Session, joinedload
from datetime import datetime
import models

# Massimo numero di snapshot mantenuti per ogni parametro
MAX_PER_PARAMETER = 10


def create_parameter_submission(
    db: Session,
    parameter: models.ParameterDef,
    user_id: int,
    note: str = "",
    fixed_time: datetime = None,
):
    """Snapshot 'full' della *definizione* di un parametro.

    Salva: ParameterDef + tutte le Question + motivations ammesse per ciascuna
    Question. Niente dati delle lingue (quelli vivono nei Submission).
    """
    now = fixed_time or datetime.utcnow()

    sub = models.ParameterSubmission(
        parameter_id=parameter.id,
        parameter_name=parameter.name or "",
        submitted_by_id=user_id,
        submitted_at=now,
        note=note or "",
        short_description=parameter.short_description or "",
        long_description=parameter.long_description or "",
        implicational_condition=parameter.implicational_condition,
        description_of_the_implicational_condition=
            parameter.description_of_the_implicational_condition or "",
        is_active=parameter.is_active,
        position=parameter.position,
        schema=parameter.schema or "",
        param_type=parameter.param_type or "",
        level_of_comparison=parameter.level_of_comparison or "",
    )
    db.add(sub)
    db.flush()

    questions = (
        db.query(models.Question)
        .options(
            joinedload(models.Question.allowed_motivations)
            .joinedload(models.QuestionAllowedMotivation.motivation)
        )
        .filter(models.Question.parameter_id == parameter.id)
        .all()
    )

    for q in questions:
        sub_q = models.ParameterSubmissionQuestion(
            submission_id=sub.id,
            question_code=q.id,
            text=q.text or "",
            template_type=q.template_type or "",
            instruction=q.instruction,
            instruction_yes=q.instruction_yes,
            instruction_no=q.instruction_no,
            example_yes=q.example_yes,
            help_info=q.help_info,
            is_stop_question=q.is_stop_question,
            is_active=q.is_active,
        )
        db.add(sub_q)
        db.flush()

        for am in q.allowed_motivations:
            mot = am.motivation
            if mot is None:
                continue
            db.add(models.ParameterSubmissionAllowedMotivation(
                question_id=sub_q.id,
                motivation_code=mot.code,
                motivation_label=mot.label or "",
            ))

    db.flush()

    # Pruning: tieni i più recenti N
    subs = (
        db.query(models.ParameterSubmission.id)
        .filter(models.ParameterSubmission.parameter_id == parameter.id)
        .order_by(
            models.ParameterSubmission.submitted_at.desc(),
            models.ParameterSubmission.id.desc(),
        )
        .all()
    )
    pruned_count = 0
    if len(subs) > MAX_PER_PARAMETER:
        ids_to_keep = [s[0] for s in subs[:MAX_PER_PARAMETER]]
        pruned_count = (
            db.query(models.ParameterSubmission)
            .filter(
                models.ParameterSubmission.parameter_id == parameter.id,
                models.ParameterSubmission.id.notin_(ids_to_keep),
            )
            .delete(synchronize_session=False)
        )

    return sub, pruned_count


def create_all_parameters_backup(
    db: Session, user_id: int, note: str = "Global parameters backup"
):
    """Backup globale: uno snapshot per ogni parametro, accomunati dallo stesso
    timestamp (microsecondi azzerati) per formare la stessa "cartella".
    """
    parameters = db.query(models.ParameterDef).all()
    fixed_time = datetime.utcnow().replace(microsecond=0)
    total_pruned = 0

    try:
        for p in parameters:
            _, pruned = create_parameter_submission(db, p, user_id, note, fixed_time)
            total_pruned += pruned

        db.commit()

        return {
            "status": "success",
            "parameters_backed_up": len(parameters),
            "pruned": total_pruned,
            "timestamp": fixed_time,
        }
    except Exception:
        db.rollback()
        raise


def create_single_parameter_backup(
    db: Session, parameter: models.ParameterDef, user_id: int, note: str = ""
):
    """Backup di un singolo parametro: cartella dedicata col proprio timestamp."""
    fixed_time = datetime.utcnow().replace(microsecond=0)
    try:
        sub, pruned = create_parameter_submission(db, parameter, user_id, note, fixed_time)
        db.commit()
        return {
            "status": "success",
            "submission_id": sub.id,
            "parameter_id": parameter.id,
            "pruned": pruned,
            "timestamp": fixed_time,
        }
    except Exception:
        db.rollback()
        raise
