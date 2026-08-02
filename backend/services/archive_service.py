"""Servizio archivio domande obsolete: sposta Answer/Example/AnswerMotivation in tabelle archive quando una Question cambia in modo incompatibile con i dati raccolti."""
from __future__ import annotations
from typing import Dict
from datetime import datetime
import io

from openpyxl import Workbook
from time_utils import utc_now
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table, TableStyleInfo
from sqlalchemy.orm import Session
from sqlalchemy import func

import models
from services.citation import apply_excel_citation


def count_linked_data(db: Session, question_id: str) -> Dict[str, int]:
    """Quante Answer/Example/lingue sarebbero archiviate dal wipe."""
    answers_count = (
        db.query(func.count(models.Answer.id))
        .filter(models.Answer.question_id == question_id)
        .scalar()
        or 0
    )
    languages_count = (
        db.query(func.count(func.distinct(models.Answer.language_id)))
        .filter(models.Answer.question_id == question_id)
        .scalar()
        or 0
    )
    examples_count = (
        db.query(func.count(models.Example.id))
        .join(models.Answer, models.Example.answer_id == models.Answer.id)
        .filter(models.Answer.question_id == question_id)
        .scalar()
        or 0
    )
    return {
        "answers": int(answers_count),
        "examples": int(examples_count),
        "languages": int(languages_count),
    }


def snapshot_question_data(
    db: Session,
    question: models.Question,
    user_id: int | None,
    archive_note: str | None = None,
) -> models.ArchivedQuestion:
    """Snapshot della question e copia di Answer/Example/AnswerMotivation nelle tabelle archive, senza cancellare i dati attivi (non committa)."""
    # Nome parametro congelato nello snapshot (denormalizzato).
    parameter_def = (
        db.query(models.ParameterDef)
        .filter(models.ParameterDef.id == question.parameter_id)
        .first()
    )
    param_name = parameter_def.name if parameter_def else ""

    archived_question = models.ArchivedQuestion(
        original_question_id=question.id,
        parameter_id=question.parameter_id,
        parameter_name=param_name,
        text=question.text or "",
        template_type=question.template_type or "",
        instruction=question.instruction,
        instruction_yes=question.instruction_yes,
        instruction_no=question.instruction_no,
        example_yes=question.example_yes,
        help_info=question.help_info,
        is_stop_question=bool(question.is_stop_question),
        is_active=bool(question.is_active),
        archived_at=utc_now(),
        archived_by_id=user_id,
        archive_note=(archive_note or "").strip(),
    )
    db.add(archived_question)
    db.flush()

    # Code e label delle motivazioni congelati nello snapshot.
    allowed_motivations = (
        db.query(models.QuestionAllowedMotivation, models.Motivation)
        .join(models.Motivation, models.QuestionAllowedMotivation.motivation_id == models.Motivation.id)
        .filter(models.QuestionAllowedMotivation.question_id == question.id)
        .all()
    )
    for _qam, motivation in allowed_motivations:
        db.add(models.ArchivedQuestionMotivation(
            archived_question_id=archived_question.id,
            motivation_code=motivation.code or "",
            motivation_label=motivation.label or "",
        ))

    # Nome lingua denormalizzato per ogni Answer.
    language_name_by_id: Dict[str, str] = {
        language.id: language.name_full
        for language in db.query(models.Language.id, models.Language.name_full).all()
    }

    answers = (
        db.query(models.Answer)
        .filter(models.Answer.question_id == question.id)
        .all()
    )
    answers_count = 0
    examples_count = 0
    for answer in answers:
        archived_answer = models.ArchivedAnswer(
            archived_question_id=archived_question.id,
            language_id=answer.language_id,
            language_name_full=language_name_by_id.get(answer.language_id, "") or "",
            status=answer.status,
            response_text=answer.response_text,
            comments=answer.comments,
            original_updated_at=answer.updated_at,
        )
        db.add(archived_answer)
        db.flush()
        answers_count += 1

        for example in answer.examples:
            db.add(models.ArchivedExample(
                archived_answer_id=archived_answer.id,
                number=example.number or "",
                textarea=example.textarea,
                transliteration=example.transliteration,
                gloss=example.gloss,
                translation=example.translation,
                reference=example.reference,
            ))
            examples_count += 1

        for answer_motivation in answer.answer_motivations:
            motivation = answer_motivation.motivation
            db.add(models.ArchivedAnswerMotivation(
                archived_answer_id=archived_answer.id,
                motivation_code=(motivation.code if motivation else "") or "",
                motivation_label=(motivation.label if motivation else "") or "",
            ))

    archived_question.answers_count = answers_count
    archived_question.examples_count = examples_count

    db.flush()
    return archived_question


def archive_and_wipe(
    db: Session,
    question: models.Question,
    user_id: int | None,
    archive_note: str | None = None,
) -> models.ArchivedQuestion:
    """Snapshot della question (va chiamata PRIMA di modificarne il testo) + cancellazione dei dati attivi; non committa."""
    archived_question = snapshot_question_data(db, question, user_id, archive_note)

    # Le cascade "all, delete-orphan" gestiscono Example/AnswerMotivation.
    answers = (
        db.query(models.Answer)
        .filter(models.Answer.question_id == question.id)
        .all()
    )
    for answer in answers:
        db.delete(answer)

    db.flush()
    return archived_question


ARCHIVED_DB_HEADERS = [
    "Language",
    "Language ID",
    "Parameter ID",
    "Parameter Name",
    "Question ID",
    "Question Text (archived)",
    "Question Examples YES (archived)",
    "Question Instructions (archived)",
    "Language Answer",
    "Language Comments",
    "Language Motivations",
    "Language Examples",
    "Language Example Transliteration",
    "Language Example Gloss",
    "Language Example Translation",
    "Language References",
]

_BOLD_WHITE = Font(bold=True, color="FFFFFF")


def _bold_header_row(worksheet, column_count: int):
    for column_index in range(1, column_count + 1):
        worksheet.cell(row=1, column=column_index).font = _BOLD_WHITE


def _style_table(worksheet, name: str, column_count: int, column_widths):
    if worksheet.max_row < 2:
        for column_index, width in enumerate(column_widths, start=1):
            if column_index > column_count:
                break
            worksheet.column_dimensions[get_column_letter(column_index)].width = width
        return
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


def build_archived_question_workbook(
    db: Session, archived_question: models.ArchivedQuestion
) -> Workbook:
    """Workbook con un solo sheet "Database_model": una riga per lingua, tutta l'info dallo snapshot archive (niente lookup vivi)."""
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = "Database_model"
    worksheet.append(ARCHIVED_DB_HEADERS)
    _bold_header_row(worksheet, len(ARCHIVED_DB_HEADERS))

    answers = sorted(archived_question.answers, key=lambda a: a.language_id)
    for answer in answers:
        # Stringa in stile vecchio progetto (YES/NO).
        if answer.response_text == "yes":
            answer_label = "YES"
        elif answer.response_text == "no":
            answer_label = "NO"
        else:
            answer_label = ""

        examples = sorted(answer.examples, key=lambda e: (e.number or "", e.id or 0))
        cell_examples = "\n".join((example.textarea or "") for example in examples) if examples else ""
        cell_transliteration = "\n".join((example.transliteration or "") for example in examples) if examples else ""
        cell_gloss = "\n".join((example.gloss or "") for example in examples) if examples else ""
        cell_translation = "\n".join((example.translation or "") for example in examples) if examples else ""
        cell_refs = "\n".join((example.reference or "") for example in examples) if examples else ""

        motivations_label = ", ".join(
            f"{m.motivation_code} ({m.motivation_label})" if m.motivation_label else m.motivation_code
            for m in answer.answer_motivations
        )

        worksheet.append([
            answer.language_name_full or "",
            answer.language_id or "",
            archived_question.parameter_id or "",
            archived_question.parameter_name or "",
            archived_question.original_question_id or "",
            archived_question.text or "",
            archived_question.example_yes or "",
            archived_question.instruction or "",
            answer_label,
            answer.comments or "",
            motivations_label,
            cell_examples,
            cell_transliteration,
            cell_gloss,
            cell_translation,
            cell_refs,
        ])

    _style_table(
        worksheet, "ArchivedDatabaseModel", len(ARCHIVED_DB_HEADERS),
        [22, 12, 12, 22, 14, 36, 26, 26, 12, 22, 26, 30, 24, 22, 26, 24],
    )
    apply_excel_citation(workbook)
    return workbook


def workbook_to_bytes(workbook: Workbook) -> bytes:
    buffer = io.BytesIO()
    workbook.save(buffer)
    buffer.seek(0)
    return buffer.getvalue()
