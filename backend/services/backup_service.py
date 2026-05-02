from sqlalchemy.orm import Session, joinedload
from datetime import datetime
from time_utils import utc_now
import models

# Massimo numero di salvataggi storici mantenuti per ogni lingua
MAX_PER_LANGUAGE = 10

def create_language_submission(db: Session, language: models.Language, user_id: int, note: str = "", fixed_time: datetime = None):
    """
    Crea uno snapshot 'full' per una singola lingua.
    Equivalente al vecchio services.py di Django.
    """
    now = fixed_time or utc_now()

    # 1. Creazione record principale Submission
    sub = models.Submission(
        language_id=language.id,
        submitted_by_id=user_id,
        submitted_at=now,
        note=note or ""
    )
    db.add(sub)
    db.flush() # Fa l'insert nel DB per ottenere l'ID della submission, ma senza committare

    # 2. Estrazione e copia delle Answers (con Motivations e Examples)
    # Usiamo joinedload per evitare il problema query N+1, come faceva select_related/prefetch_related
    answers = db.query(models.Answer).options(
        joinedload(models.Answer.examples),
        joinedload(models.Answer.answer_motivations).joinedload(models.AnswerMotivation.motivation)
    ).filter(models.Answer.language_id == language.id).all()

    sub_answers = []
    sub_mots = []
    sub_ex = []

    for a in answers:
        sub_answers.append(models.SubmissionAnswer(
            submission_id=sub.id,
            question_code=a.question_id,
            response_text=a.response_text,
            comments=a.comments or ""
        ))
        for am in a.answer_motivations:
            sub_mots.append(models.SubmissionAnswerMotivation(
                submission_id=sub.id,
                question_code=a.question_id,
                motivation_code=am.motivation.code,
                motivation_label=am.motivation.label,
            ))
        for ex in a.examples:
            sub_ex.append(models.SubmissionExample(
                submission_id=sub.id,
                question_code=a.question_id,
                textarea=ex.textarea or "",
                transliteration=ex.transliteration or "",
                gloss=ex.gloss or "",
                translation=ex.translation or "",
                reference=ex.reference or ""
            ))

    # 3. Estrazione e copia dei Parametri + Eval (DAG)
    lparams = db.query(models.LanguageParameter).options(
        joinedload(models.LanguageParameter.eval)
    ).filter(models.LanguageParameter.language_id == language.id).all()

    sub_params = []
    for lp in lparams:
        eval_obj = lp.eval
        sub_params.append(models.SubmissionParam(
            submission_id=sub.id,
            parameter_id=lp.parameter_id,
            value_orig=lp.value_orig,
            warning_orig=lp.warning_orig,
            value_eval=eval_obj.value_eval if eval_obj else "0",
            warning_eval=eval_obj.warning_eval if eval_obj else False,
            evaluated_at=now
        ))

    # Inserimento massivo stile bulk_create
    db.add_all(sub_answers)
    db.add_all(sub_mots)
    db.add_all(sub_ex)
    db.add_all(sub_params)
    db.flush()

    # 4. Pruning automatico per limitare lo storage
    subs = db.query(models.Submission.id).filter(
        models.Submission.language_id == language.id
    ).order_by(models.Submission.submitted_at.desc(), models.Submission.id.desc()).all()

    pruned_count = 0
    if len(subs) > MAX_PER_LANGUAGE:
        # Teniamo solo i primi N ID
        ids_to_keep = [s[0] for s in subs[:MAX_PER_LANGUAGE]]
        deleted = db.query(models.Submission).filter(
            models.Submission.language_id == language.id,
            models.Submission.id.notin_(ids_to_keep)
        ).delete(synchronize_session=False)
        pruned_count = deleted

    return sub, pruned_count

def create_all_languages_backup(db: Session, user_id: int, note: str = "Global backup"):
    """
    Forza un backup globale sincronizzato per tutte le lingue.
    Tutte le query condividono una singola transazione.
    """
    languages = db.query(models.Language).all()

    # Trucco fondamentale: azzeriamo i microsecondi per far sì che
    # tutto il backup appartenga alla stessa identica data (la nostra "cartella")
    fixed_time = utc_now().replace(microsecond=0)

    total_pruned = 0

    try:
        for lang in languages:
            _, pruned = create_language_submission(db, lang, user_id, note, fixed_time)
            total_pruned += pruned

        # Confermiamo l'intera transazione solo se tutte le lingue sono state processate con successo
        db.commit()

        return {
            "status": "success",
            "languages_backed_up": len(languages),
            "pruned": total_pruned,
            "timestamp": fixed_time
        }
    except Exception as e:
        # Se anche un solo elemento fallisce, annulliamo tutto (equivalente di with transaction.atomic() in Django)
        db.rollback()
        raise e
    