"""Backup 'submission': 
snapshot storico di una o tutte le lingue (Answer/Example/Motivation/Parametri congelati in tabelle Submission*) 
con pruning automatico, più l'export xlsx di una submission salvata."""

from sqlalchemy.orm import Session, joinedload
from datetime import datetime
from time_utils import utc_now
import io

from openpyxl import Workbook
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table, TableStyleInfo

import models
from services.citation import apply_excel_citation

MAX_PER_LANGUAGE = 10

def create_language_submission(db: Session, language: models.Language, user_id: int, note: str = "", fixed_time: datetime = None):
    """Crea uno snapshot 'full' di una lingua (Submission + risposte/motivazioni/esempi/parametri), con pruning automatico oltre MAX_PER_LANGUAGE."""
    now = fixed_time or utc_now()

    submission = models.Submission(
        language_id=language.id,
        submitted_by_id=user_id,
        submitted_at=now,
        note=note or ""
    )
    db.add(submission)
    db.flush()

    answers = db.query(models.Answer).options(
        joinedload(models.Answer.examples),
        joinedload(models.Answer.answer_motivations).joinedload(models.AnswerMotivation.motivation)
    ).filter(models.Answer.language_id == language.id).all()

    submission_answers = []
    submission_motivations = []
    submission_examples = []

    for answer in answers:
        submission_answers.append(models.SubmissionAnswer(
            submission_id=submission.id,
            question_code=answer.question_id,
            response_text=answer.response_text,
            comments=answer.comments or ""
        ))
        for answer_motivation in answer.answer_motivations:
            submission_motivations.append(models.SubmissionAnswerMotivation(
                submission_id=submission.id,
                question_code=answer.question_id,
                motivation_code=answer_motivation.motivation.code,
                motivation_label=answer_motivation.motivation.label,
            ))
        for example in answer.examples:
            submission_examples.append(models.SubmissionExample(
                submission_id=submission.id,
                question_code=answer.question_id,
                textarea=example.textarea or "",
                transliteration=example.transliteration or "",
                gloss=example.gloss or "",
                translation=example.translation or "",
                reference=example.reference or "",
                is_test=bool(example.is_test),
            ))

    language_parameters = db.query(models.LanguageParameter).options(
        joinedload(models.LanguageParameter.eval)
    ).filter(models.LanguageParameter.language_id == language.id).all()

    submission_params = []
    for language_parameter in language_parameters:
        evaluation = language_parameter.eval
        submission_params.append(models.SubmissionParam(
            submission_id=submission.id,
            parameter_id=language_parameter.parameter_id,
            value_orig=language_parameter.value_orig,
            warning_orig=language_parameter.warning_orig,
            value_eval=evaluation.value_eval if evaluation else "0",
            warning_eval=evaluation.warning_eval if evaluation else False,
            evaluated_at=now
        ))

    db.add_all(submission_answers)
    db.add_all(submission_motivations)
    db.add_all(submission_examples)
    db.add_all(submission_params)
    db.flush()

    existing_submissions = db.query(models.Submission.id).filter(
        models.Submission.language_id == language.id
    ).order_by(models.Submission.submitted_at.desc(), models.Submission.id.desc()).all()

    pruned_count = 0
    if len(existing_submissions) > MAX_PER_LANGUAGE:
        ids_to_keep = [s[0] for s in existing_submissions[:MAX_PER_LANGUAGE]]
        deleted = db.query(models.Submission).filter(
            models.Submission.language_id == language.id,
            models.Submission.id.notin_(ids_to_keep)
        ).delete(synchronize_session=False)
        pruned_count = deleted

    return submission, pruned_count

def create_all_languages_backup(db: Session, user_id: int, note: str = "Global backup"):
    languages = db.query(models.Language).all()

    # Azzeriamo i microsecondi così tutto il backup appartiene alla stessa identica data.
    fixed_time = utc_now().replace(microsecond=0)

    total_pruned = 0

    try:
        for language in languages:
            _, pruned = create_language_submission(db, language, user_id, note, fixed_time)
            total_pruned += pruned

        db.commit()

        return {
            "status": "success",
            "languages_backed_up": len(languages),
            "pruned": total_pruned,
            "timestamp": fixed_time
        }
    except Exception as exception:
        db.rollback()
        raise exception


_BOLD_WHITE = Font(bold=True, color="FFFFFF")


def _bold_header_row(worksheet, column_count: int) -> None:
    for column_index in range(1, column_count + 1):
        worksheet.cell(row=1, column=column_index).font = _BOLD_WHITE


def _style_table(worksheet, name: str, column_count: int, column_widths) -> None:
    """TableStyleMedium2 ha fondo header blu: necessario perché _bold_header_row imposta font bianco, altrimenti illeggibile."""
    if worksheet.max_row >= 2:
        table_range = f"A1:{get_column_letter(column_count)}{worksheet.max_row}"
        table = Table(displayName=name, ref=table_range)
        table.tableStyleInfo = TableStyleInfo(
            name="TableStyleMedium2",
            showFirstColumn=False, showLastColumn=False,
            showRowStripes=True, showColumnStripes=False,
        )
        worksheet.add_table(table)
        worksheet.freeze_panes = "A2"
    for column_index, width in enumerate(column_widths, start=1):
        if column_index > column_count:
            break
        worksheet.column_dimensions[get_column_letter(column_index)].width = width


_INFO_HEADERS = ["Field", "Value"]
_PARAMS_HEADERS = ["Parameter", "Initial value", "Warning init", "Final value", "Warning final"]
_ANSWERS_HEADERS = ["Question", "Answer", "Motivations", "Comments"]
_EXAMPLES_HEADERS = ["Question", "Example text", "Transliteration", "Gloss", "Translation", "Reference", "Is Test"]


def build_submission_workbook(db: Session, submission: models.Submission) -> Workbook:
    """Workbook con 4 sheet (Info, Parameters, Answers, Examples) per il backup di una lingua; tutti i dati vengono dallo snapshot Submission, niente lookup sulle tabelle vive."""
    workbook = Workbook()

    info_sheet = workbook.active
    info_sheet.title = "Info"
    info_sheet.append(_INFO_HEADERS)
    _bold_header_row(info_sheet, len(_INFO_HEADERS))

    language = submission.language
    submitter = (
        f"{submission.submitted_by.name or ''} {submission.submitted_by.surname or ''}".strip()
        or (submission.submitted_by.email if submission.submitted_by else "")
    ) if submission.submitted_by_id else "System"
    submitted_at_str = submission.submitted_at.strftime("%Y-%m-%d %H:%M UTC") if submission.submitted_at else ""

    info_sheet.append(["Language ID", language.id if language else (submission.language_id or "")])
    info_sheet.append(["Language name", language.name_full if language else ""])
    info_sheet.append(["Backup date (UTC)", submitted_at_str])
    info_sheet.append(["Submitted by", submitter])
    info_sheet.append(["Note", submission.note or ""])
    _style_table(info_sheet, "BackupInfo", len(_INFO_HEADERS), [22, 60])

    parameters_sheet = workbook.create_sheet("Parameters")
    parameters_sheet.append(_PARAMS_HEADERS)
    _bold_header_row(parameters_sheet, len(_PARAMS_HEADERS))
    params_sorted = sorted(submission.params, key=lambda p: p.parameter_id or "")
    for submission_param in params_sorted:
        parameters_sheet.append([
            submission_param.parameter_id or "",
            submission_param.value_orig or "",
            "Yes" if submission_param.warning_orig else "",
            submission_param.value_eval or "",
            "Yes" if submission_param.warning_eval else "",
        ])
    _style_table(parameters_sheet, "BackupParameters", len(_PARAMS_HEADERS), [16, 14, 14, 14, 14])

    # Label delle motivations per question_code, con fallback su code se manca la label.
    motivations_by_question_code: dict[str, list[str]] = {}
    for answer_motivation in submission.answer_motivations:
        label = answer_motivation.motivation_label or answer_motivation.motivation_code or ""
        if label:
            motivations_by_question_code.setdefault(answer_motivation.question_code, []).append(label)

    answers_sheet = workbook.create_sheet("Answers")
    answers_sheet.append(_ANSWERS_HEADERS)
    _bold_header_row(answers_sheet, len(_ANSWERS_HEADERS))
    answers_sorted = sorted(submission.answers, key=lambda a: a.question_code or "")
    for answer in answers_sorted:
        response_label = ""
        if answer.response_text == "yes":
            response_label = "YES"
        elif answer.response_text == "no":
            response_label = "NO"
        elif answer.response_text == "unsure":
            response_label = "UNSURE"
        elif answer.response_text == "missing":
            response_label = "MISSING"
        elif answer.response_text:
            response_label = answer.response_text
        answers_sheet.append([
            answer.question_code or "",
            response_label,
            "; ".join(motivations_by_question_code.get(answer.question_code, [])),
            answer.comments or "",
        ])
    _style_table(answers_sheet, "BackupAnswers", len(_ANSWERS_HEADERS), [16, 10, 30, 36])

    examples_sheet = workbook.create_sheet("Examples")
    examples_sheet.append(_EXAMPLES_HEADERS)
    _bold_header_row(examples_sheet, len(_EXAMPLES_HEADERS))
    examples_sorted = sorted(submission.examples, key=lambda e: (e.question_code or "", e.id or 0))
    for example in examples_sorted:
        examples_sheet.append([
            example.question_code or "",
            example.textarea or "",
            example.transliteration or "",
            example.gloss or "",
            example.translation or "",
            example.reference or "",
            "TEST" if example.is_test else "",
        ])
    _style_table(examples_sheet, "BackupExamples", len(_EXAMPLES_HEADERS), [14, 36, 22, 22, 26, 22, 8])

    apply_excel_citation(workbook)
    return workbook


def workbook_to_bytes(wb: Workbook) -> bytes:
    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()