"""Restore di un bundle ZIP prodotto da `build_backup_zip_bytes`/`build_full_backup_zip_bytes` (struttura del bundle in DEV-NOTES.md, sez. "Struttura dei bundle di backup"): sempre upsert, mai delete, salvo `wipe=True` che tronca le tabelle dati (non gli utenti) prima di importare — strategia completa in DEV-NOTES.md."""
from __future__ import annotations
from dataclasses import dataclass, field, asdict
from typing import List, Optional, Dict, Any
import io
import json
import os
import zipfile

from openpyxl import load_workbook
from sqlalchemy.orm import Session

import models
from config import LEGAL_DOCUMENTS_DIR
from services.language_alias import resolve_language
from services.parameter_alias import resolve_parameter
from services.question_alias import resolve_question
from services.excel_import import import_excel, ImportReport
from services.migration_progress import ProgressReporter, NULL_PROGRESS
from services.dag_eval import run_dag_for_language


@dataclass
class BackupRestoreReport:
    files_processed: List[str] = field(default_factory=list)
    files_skipped: List[str] = field(default_factory=list)
    errors: List[Dict[str, Any]] = field(default_factory=list)
    by_file: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    languages_restored: List[str] = field(default_factory=list)
    languages_failed: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "files_processed": self.files_processed,
            "files_skipped": self.files_skipped,
            "errors": self.errors,
            "by_file": self.by_file,
            "languages_restored": self.languages_restored,
            "languages_failed": self.languages_failed,
            "total_errors": len(self.errors),
        }


def _absorb_sub_report(report: BackupRestoreReport, file_name: str, import_report: ImportReport) -> None:
    """Copia errori e summary di una `import_excel` interna nel report globale."""
    report.files_processed.append(file_name)
    report.by_file[file_name] = {
        "sheets_processed": import_report.sheets_processed,
        "by_sheet": {sheet_name: sheet_report.to_dict() for sheet_name, sheet_report in import_report.by_sheet.items()},
        "errors_count": len(import_report.errors),
    }
    for sub_error in import_report.errors:
        error_dict = sub_error.to_dict()
        error_dict["_file"] = file_name
        report.errors.append(error_dict)


# Stesse tabelle di migration_import.import_migration_bundle, duplicate apposta
# per non far dipendere backup_restore dall'altro servizio (dettagli in DEV-NOTES.md).
_WIPE_TABLES_FK_SAFE = [
    "answer_motivations",
    "examples",
    "answers",
    "language_parameter_evals",
    "language_parameters",
    "language_parameter_statuses",
    "submission_answer_motivations",
    "submission_examples",
    "submission_params",
    "submission_answers",
    "submissions",
    "archived_answer_motivations",
    "archived_examples",
    "archived_answers",
    "archived_question_motivations",
    "archived_questions",
    "parameter_submission_allowed_motivations",
    "parameter_submission_questions",
    "parameter_submissions",
    "question_allowed_motivations",
    "questions",
    "parameter_change_logs",
    "parameter_defs",
    "motivations",
    "languages",
    "groups",
    "families",
    "top_families",
    "glossary",
    "site_contents",
]


def _wipe_data(db: Session) -> None:
    from sqlalchemy import text
    for table_name in _WIPE_TABLES_FK_SAFE:
        try:
            db.execute(text(f"DELETE FROM {table_name}"))
        except Exception:
            # Tabella inesistente nel DB corrente: skip senza errore.
            db.rollback()
    db.commit()


SCHEMA_FILE = "schema.xlsx"
METADATA_FILE = "languages_metadata.xlsx"
GLOSSARY_FILE = "glossary.xlsx"
LANG_DIR = "languages/"
EXTRAS_DIR = "extras/"


def restore_backup_bundle(
    db: Session,
    zip_bytes: bytes,
    current_user_id: int,
    *,
    wipe: bool = False,
    progress: ProgressReporter = NULL_PROGRESS,
) -> BackupRestoreReport:
    report = BackupRestoreReport()

    try:
        zip_file = zipfile.ZipFile(io.BytesIO(zip_bytes), "r")
    except zipfile.BadZipFile as exception:
        report.errors.append({"_file": "(bundle)", "reason": f"Not a valid ZIP file: {exception}"})
        return report

    namelist = zip_file.namelist()

    if wipe:
        progress.phase("wipe", "Wiping data tables…", total=1)
        try:
            _wipe_data(db)
            progress.tick(1)
        except Exception as exception:
            report.errors.append({"_file": "(wipe)", "reason": f"Wipe failed: {exception}"})
            return report

    if SCHEMA_FILE in namelist:
        progress.phase("schema", "Importing schema…", total=1)
        with zip_file.open(SCHEMA_FILE) as file_handle:
            import_report = import_excel(db, file_handle.read(), current_user_id, create_missing=True)
        _absorb_sub_report(report, SCHEMA_FILE, import_report)
        progress.tick(1)
    else:
        report.errors.append({"_file": SCHEMA_FILE, "reason": "Missing schema.xlsx in bundle"})

    if METADATA_FILE in namelist:
        progress.phase("metadata", "Importing languages metadata…", total=1)
        with zip_file.open(METADATA_FILE) as file_handle:
            import_report = import_excel(db, file_handle.read(), current_user_id, create_missing=True)
        _absorb_sub_report(report, METADATA_FILE, import_report)
        progress.tick(1)
    else:
        report.files_skipped.append(METADATA_FILE)

    if GLOSSARY_FILE in namelist:
        progress.phase("glossary", "Importing glossary…", total=1)
        with zip_file.open(GLOSSARY_FILE) as file_handle:
            import_report = import_excel(db, file_handle.read(), current_user_id, create_missing=True)
        _absorb_sub_report(report, GLOSSARY_FILE, import_report)
        progress.tick(1)
    else:
        report.files_skipped.append(GLOSSARY_FILE)

    lang_files = sorted(
        entry_name for entry_name in namelist
        if entry_name.startswith(LANG_DIR) and entry_name.endswith(".xlsx") and not entry_name.endswith("/")
    )
    language_count = len(lang_files)
    progress.phase("compilation", f"Restoring {language_count} language(s)…", total=language_count)
    for index, name in enumerate(lang_files, start=1):
        lang_id = os.path.splitext(os.path.basename(name))[0]
        progress.tick(current=index, label=f"Restoring {lang_id} ({index}/{language_count})")
        try:
            with zip_file.open(name) as file_handle:
                import_report = import_excel(db, file_handle.read(), current_user_id, create_missing=True)
        except Exception as exception:
            report.errors.append({"_file": name, "reason": f"Cannot read entry: {exception}"})
            report.languages_failed.append(lang_id)
            continue
        _absorb_sub_report(report, name, import_report)
        if import_report.errors:
            report.languages_failed.append(lang_id)
        else:
            report.languages_restored.append(lang_id)

    # site_content sempre upsertato; le tabelle snapshot solo con wipe=True (dettagli in DEV-NOTES.md).
    extras_files = [
        entry_name for entry_name in namelist
        if entry_name.startswith(EXTRAS_DIR) and (entry_name.endswith(".xlsx") or entry_name.endswith(".jsonl"))
    ]
    if extras_files:
        progress.phase("extras", f"Restoring {len(extras_files)} extra file(s)…", total=len(extras_files))
        for index, name in enumerate(extras_files, start=1):
            base_name = os.path.basename(name)
            progress.tick(current=index, label=f"Restoring {base_name} ({index}/{len(extras_files)})")
            try:
                with zip_file.open(name) as file_handle:
                    data = file_handle.read()
                handler = _EXTRAS_HANDLERS.get(base_name)
                if handler is None:
                    report.files_skipped.append(name)
                    continue
                handler(db, data, name, report, wipe=wipe, current_user_id=current_user_id)
            except Exception as exception:
                report.errors.append({"_file": name, "reason": f"Cannot restore extras: {exception}"})
                db.rollback()

    # PDF dell'archivio legale: mai sovrascritti se già presenti (immutabili, dettagli in DEV-NOTES.md).
    pdf_entries = [
        entry_name for entry_name in namelist
        if entry_name.startswith("extras/legal_pdfs/") and not entry_name.endswith("/")
    ]
    if pdf_entries:
        restored_count = already_present_count = 0
        try:
            os.makedirs(LEGAL_DOCUMENTS_DIR, exist_ok=True)
        except Exception as exception:
            report.errors.append({
                "_file": "extras/legal_pdfs/",
                "reason": f"Cannot create legal documents dir: {exception}",
            })
        else:
            for pdf_entry in pdf_entries:
                filename = os.path.basename(pdf_entry)
                if not filename:
                    continue
                target_path = os.path.join(LEGAL_DOCUMENTS_DIR, filename)
                if os.path.exists(target_path):
                    already_present_count += 1
                    continue
                try:
                    with zip_file.open(pdf_entry) as source_file, open(target_path, "wb") as dest_file:
                        dest_file.write(source_file.read())
                    restored_count += 1
                except Exception as exception:
                    report.errors.append({"_file": pdf_entry, "reason": f"Cannot restore PDF: {exception}"})
            report.by_file["extras/legal_pdfs/"] = {
                "restored": restored_count, "already_present": already_present_count,
            }

    # Ricalcola value_orig/value_eval per ogni lingua ripristinata: il bundle non li contiene (dettagli in DEV-NOTES.md).
    if report.languages_restored:
        restored_language_count = len(report.languages_restored)
        progress.phase("recompute", f"Recomputing final values for {restored_language_count} language(s)…", total=restored_language_count)
        for index, lang_id in enumerate(report.languages_restored, start=1):
            progress.tick(current=index, label=f"Recomputing {lang_id} ({index}/{restored_language_count})")
            try:
                run_dag_for_language(lang_id, db)
                db.commit()
            except Exception as exception:
                db.rollback()
                report.errors.append({"_file": f"recompute/{lang_id}", "reason": f"Recompute failed: {exception}"})

    return report


# Ogni handler legge un xlsx noto (vedi services/excel_export.py per gli sheet) e
# ripristina le righe in DB. Pattern per le tabelle gerarchiche: inserisci il
# parent senza id esplicito (evita collisioni sulla PK auto-increment), tieni
# una mappa old_id -> new_id, poi inserisci i child rimappando la FK.


def _read_sheet_rows(data: bytes, sheet_name: str):
    """Restituisce (headers, rows) — generatore di dict header→value, righe vuote filtrate — o (None, None) se lo sheet non esiste."""
    workbook = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    if sheet_name not in workbook.sheetnames:
        return None, None
    worksheet = workbook[sheet_name]
    rows_iter = worksheet.iter_rows(values_only=True)
    try:
        headers = list(next(rows_iter))
    except StopIteration:
        return [], iter([])

    def _generator():
        for cell_values in rows_iter:
            if not any(cell is not None and cell != "" for cell in cell_values):
                continue
            yield dict(zip(headers, cell_values))

    return headers, _generator()


def _user_id_by_email(db: Session) -> Dict[str, int]:
    return {user.email: user.id for user in db.query(models.User).all() if user.email}


def _yn_to_bool(value) -> bool:
    text = (str(value) if value is not None else "").strip().lower()
    return text in ("yes", "true", "1", "y")


def _restore_site_content(
    db: Session, data: bytes, name: str, report: "BackupRestoreReport",
    *, wipe: bool, current_user_id: int,
) -> None:
    """Upsert per chiave naturale (`key`). Funziona sia con wipe sia senza."""
    headers, rows = _read_sheet_rows(data, "SiteContents")
    if rows is None:
        report.files_skipped.append(name)
        return

    user_id_by_email = _user_id_by_email(db)
    inserted = updated = 0
    for row in rows:
        key = row.get("Key")
        if not key:
            continue
        existing = db.query(models.SiteContent).filter(models.SiteContent.key == key).first()
        updated_by_id = user_id_by_email.get(row.get("Updated By Email")) if row.get("Updated By Email") else None
        if existing:
            existing.content = row.get("Content") or ""
            existing.page = row.get("Page")
            existing.updated_by_id = updated_by_id
            updated += 1
        else:
            db.add(models.SiteContent(
                key=key,
                content=row.get("Content") or "",
                page=row.get("Page"),
                updated_by_id=updated_by_id,
            ))
            inserted += 1
    db.commit()
    report.files_processed.append(name)
    report.by_file[name] = {"inserted": inserted, "updated": updated}


def _restore_submissions(
    db: Session, data: bytes, name: str, report: "BackupRestoreReport",
    *, wipe: bool, current_user_id: int,
) -> None:
    """Snapshot di lingue inviate per approvazione. Restorato SOLO con wipe=True."""
    if not wipe:
        report.files_skipped.append(name)
        report.by_file[name] = {"reason": "skipped (wipe=False)"}
        return

    user_id_by_email = _user_id_by_email(db)
    submission_id_map: Dict[int, int] = {}

    _, rows = _read_sheet_rows(data, "Submissions")
    if rows is None:
        report.files_skipped.append(name)
        return
    submissions_count = 0
    for row in rows:
        old_id = row.get("ID")
        if old_id is None:
            continue
        file_lang_id = row.get("Language ID") or ""
        resolved = resolve_language(db, file_lang_id)
        if resolved.language is None:
            report.errors.append({
                "_file": name, "_row_id": int(old_id),
                "reason": f"Language '{file_lang_id}' not found (no current id, no historical alias).",
            })
            continue
        submission = models.Submission(
            language_id=resolved.language.id,
            submitted_by_id=user_id_by_email.get(row.get("Submitted By Email")) if row.get("Submitted By Email") else None,
            submitted_at=row.get("Submitted At"),
            note=row.get("Note") or "",
        )
        db.add(submission)
        db.flush()
        submission_id_map[int(old_id)] = submission.id
        submissions_count += 1

    answers_count = examples_count = answer_motivations_count = params_count = 0
    _, rows = _read_sheet_rows(data, "SubmissionAnswers")
    if rows is not None:
        for row in rows:
            new_submission_id = submission_id_map.get(int(row["Submission ID"])) if row.get("Submission ID") is not None else None
            if new_submission_id is None:
                continue
            db.add(models.SubmissionAnswer(
                submission_id=new_submission_id,
                question_code=row.get("Question Code") or "",
                response_text=row.get("Response Text") or None,
                comments=row.get("Comments"),
            ))
            answers_count += 1

    _, rows = _read_sheet_rows(data, "SubmissionExamples")
    if rows is not None:
        for row in rows:
            new_submission_id = submission_id_map.get(int(row["Submission ID"])) if row.get("Submission ID") is not None else None
            if new_submission_id is None:
                continue
            db.add(models.SubmissionExample(
                submission_id=new_submission_id,
                question_code=row.get("Question Code") or "",
                textarea=row.get("Textarea"),
                transliteration=row.get("Transliteration"),
                gloss=row.get("Gloss"),
                translation=row.get("Translation"),
                reference=row.get("Reference"),
                is_test=str(row.get("Is Test") or "").strip().upper() in ("TEST", "YES", "Y", "TRUE", "1", "X"),
            ))
            examples_count += 1

    _, rows = _read_sheet_rows(data, "SubmissionAnswerMotivations")
    if rows is not None:
        for row in rows:
            new_submission_id = submission_id_map.get(int(row["Submission ID"])) if row.get("Submission ID") is not None else None
            if new_submission_id is None:
                continue
            db.add(models.SubmissionAnswerMotivation(
                submission_id=new_submission_id,
                question_code=row.get("Question Code") or "",
                motivation_code=row.get("Motivation Code") or "",
                motivation_label=row.get("Motivation Label"),
            ))
            answer_motivations_count += 1

    _, rows = _read_sheet_rows(data, "SubmissionParams")
    if rows is not None:
        for row in rows:
            new_submission_id = submission_id_map.get(int(row["Submission ID"])) if row.get("Submission ID") is not None else None
            if new_submission_id is None:
                continue
            db.add(models.SubmissionParam(
                submission_id=new_submission_id,
                parameter_id=row.get("Parameter ID") or "",
                value_orig=row.get("Value Orig") or None,
                warning_orig=_yn_to_bool(row.get("Warning Orig")),
                value_eval=row.get("Value Eval") or None,
                warning_eval=_yn_to_bool(row.get("Warning Eval")),
                evaluated_at=row.get("Evaluated At"),
            ))
            params_count += 1

    db.commit()
    report.files_processed.append(name)
    report.by_file[name] = {
        "submissions": submissions_count, "answers": answers_count,
        "examples": examples_count, "answer_motivations": answer_motivations_count, "params": params_count,
    }


def _restore_parameter_submissions(
    db: Session, data: bytes, name: str, report: "BackupRestoreReport",
    *, wipe: bool, current_user_id: int,
) -> None:
    """Snapshot delle definizioni di parametri. Restorato SOLO con wipe=True."""
    if not wipe:
        report.files_skipped.append(name)
        report.by_file[name] = {"reason": "skipped (wipe=False)"}
        return

    user_id_by_email = _user_id_by_email(db)
    parameter_submission_id_map: Dict[int, int] = {}
    question_id_map: Dict[int, int] = {}

    _, rows = _read_sheet_rows(data, "ParameterSubmissions")
    if rows is None:
        report.files_skipped.append(name)
        return
    parameter_submissions_count = 0
    for row in rows:
        old_id = row.get("ID")
        if old_id is None:
            continue
        parameter_submission = models.ParameterSubmission(
            parameter_id=row.get("Parameter ID") or "",
            parameter_name=row.get("Parameter Name") or "",
            submitted_by_id=user_id_by_email.get(row.get("Submitted By Email")) if row.get("Submitted By Email") else None,
            submitted_at=row.get("Submitted At"),
            note=row.get("Note") or "",
            short_description=row.get("Short Description") or "",
            long_description=row.get("Long Description") or "",
            implicational_condition=row.get("Implicational Condition") or None,
            description_of_the_implicational_condition=row.get("Description Of Implicational Condition") or "",
            is_active=_yn_to_bool(row.get("Is Active")),
            position=int(row["Position"]) if row.get("Position") not in (None, "") else None,
            schema=row.get("Schema") or "",
            param_type=row.get("Param Type") or "",
            level_of_comparison=row.get("Level Of Comparison") or "",
        )
        db.add(parameter_submission)
        db.flush()
        parameter_submission_id_map[int(old_id)] = parameter_submission.id
        parameter_submissions_count += 1

    questions_count = allowed_motivations_count = 0
    _, rows = _read_sheet_rows(data, "Questions")
    if rows is not None:
        for row in rows:
            old_id = row.get("ID")
            new_parameter_submission_id = parameter_submission_id_map.get(int(row["Submission ID"])) if row.get("Submission ID") is not None else None
            if old_id is None or new_parameter_submission_id is None:
                continue
            parameter_submission_question = models.ParameterSubmissionQuestion(
                submission_id=new_parameter_submission_id,
                question_code=row.get("Question Code") or "",
                text=row.get("Text") or "",
                template_type=row.get("Template Type") or "",
                instruction=row.get("Instruction"),
                instruction_yes=row.get("Instruction YES"),
                instruction_no=row.get("Instruction NO"),
                example_yes=row.get("Example YES"),
                help_info=row.get("Help Info"),
                is_stop_question=_yn_to_bool(row.get("Is Stop Question")),
                is_active=_yn_to_bool(row.get("Is Active")),
            )
            db.add(parameter_submission_question)
            db.flush()
            question_id_map[int(old_id)] = parameter_submission_question.id
            questions_count += 1

    _, rows = _read_sheet_rows(data, "AllowedMotivations")
    if rows is not None:
        for row in rows:
            new_question_id = question_id_map.get(int(row["Question ID"])) if row.get("Question ID") is not None else None
            if new_question_id is None:
                continue
            db.add(models.ParameterSubmissionAllowedMotivation(
                question_id=new_question_id,
                motivation_code=row.get("Motivation Code") or "",
                motivation_label=row.get("Motivation Label") or "",
            ))
            allowed_motivations_count += 1

    db.commit()
    report.files_processed.append(name)
    report.by_file[name] = {
        "parameter_submissions": parameter_submissions_count, "questions": questions_count,
        "allowed_motivations": allowed_motivations_count,
    }


def _restore_archived_questions(
    db: Session, data: bytes, name: str, report: "BackupRestoreReport",
    *, wipe: bool, current_user_id: int,
) -> None:
    """Archivio di domande dismesse + answer/example/motivation collegate; SOLO con wipe=True (PK auto-increment, niente chiave naturale)."""
    if not wipe:
        report.files_skipped.append(name)
        report.by_file[name] = {"reason": "skipped (wipe=False)"}
        return

    user_id_by_email = _user_id_by_email(db)
    archived_question_id_map: Dict[int, int] = {}
    archived_answer_id_map: Dict[int, int] = {}

    _, rows = _read_sheet_rows(data, "ArchivedQuestions")
    if rows is None:
        report.files_skipped.append(name)
        return
    archived_questions_count = 0
    for row in rows:
        old_id = row.get("ID")
        if old_id is None:
            continue
        archived_question = models.ArchivedQuestion(
            original_question_id=row.get("Original Question ID") or "",
            parameter_id=row.get("Parameter ID") or "",
            parameter_name=row.get("Parameter Name") or "",
            text=row.get("Text") or "",
            template_type=row.get("Template Type") or "",
            instruction=row.get("Instruction"),
            instruction_yes=row.get("Instruction YES"),
            instruction_no=row.get("Instruction NO"),
            example_yes=row.get("Example YES"),
            help_info=row.get("Help Info"),
            is_stop_question=_yn_to_bool(row.get("Is Stop Question")),
            is_active=_yn_to_bool(row.get("Is Active")),
            archived_at=row.get("Archived At"),
            archived_by_id=user_id_by_email.get(row.get("Archived By Email")) if row.get("Archived By Email") else None,
            archive_note=row.get("Archive Note") or "",
            answers_count=int(row.get("Answers Count") or 0),
            examples_count=int(row.get("Examples Count") or 0),
        )
        db.add(archived_question)
        db.flush()
        archived_question_id_map[int(old_id)] = archived_question.id
        archived_questions_count += 1

    question_motivations_count = archived_answers_count = examples_count = answer_motivations_count = 0

    _, rows = _read_sheet_rows(data, "ArchivedQuestionMotivations")
    if rows is not None:
        for row in rows:
            new_archived_question_id = archived_question_id_map.get(int(row["Archived Question ID"])) if row.get("Archived Question ID") is not None else None
            if new_archived_question_id is None:
                continue
            db.add(models.ArchivedQuestionMotivation(
                archived_question_id=new_archived_question_id,
                motivation_code=row.get("Motivation Code") or "",
                motivation_label=row.get("Motivation Label") or "",
            ))
            question_motivations_count += 1

    _, rows = _read_sheet_rows(data, "ArchivedAnswers")
    if rows is not None:
        for row in rows:
            old_id = row.get("ID")
            new_archived_question_id = archived_question_id_map.get(int(row["Archived Question ID"])) if row.get("Archived Question ID") is not None else None
            if old_id is None or new_archived_question_id is None:
                continue
            archived_answer = models.ArchivedAnswer(
                archived_question_id=new_archived_question_id,
                language_id=row.get("Language ID") or "",
                language_name_full=row.get("Language Name Full") or "",
                status=row.get("Status") or None,
                response_text=row.get("Response Text") or None,
                comments=row.get("Comments"),
                original_updated_at=row.get("Original Updated At"),
            )
            db.add(archived_answer)
            db.flush()
            archived_answer_id_map[int(old_id)] = archived_answer.id
            archived_answers_count += 1

    _, rows = _read_sheet_rows(data, "ArchivedExamples")
    if rows is not None:
        for row in rows:
            new_archived_answer_id = archived_answer_id_map.get(int(row["Archived Answer ID"])) if row.get("Archived Answer ID") is not None else None
            if new_archived_answer_id is None:
                continue
            db.add(models.ArchivedExample(
                archived_answer_id=new_archived_answer_id,
                number=row.get("Number") or "",
                textarea=row.get("Textarea"),
                transliteration=row.get("Transliteration"),
                gloss=row.get("Gloss"),
                translation=row.get("Translation"),
                reference=row.get("Reference"),
            ))
            examples_count += 1

    _, rows = _read_sheet_rows(data, "ArchivedAnswerMotivations")
    if rows is not None:
        for row in rows:
            new_archived_answer_id = archived_answer_id_map.get(int(row["Archived Answer ID"])) if row.get("Archived Answer ID") is not None else None
            if new_archived_answer_id is None:
                continue
            db.add(models.ArchivedAnswerMotivation(
                archived_answer_id=new_archived_answer_id,
                motivation_code=row.get("Motivation Code") or "",
                motivation_label=row.get("Motivation Label") or "",
            ))
            answer_motivations_count += 1

    db.commit()
    report.files_processed.append(name)
    report.by_file[name] = {
        "archived_questions": archived_questions_count, "question_motivations": question_motivations_count,
        "archived_answers": archived_answers_count, "examples": examples_count, "answer_motivations": answer_motivations_count,
    }


def _restore_parameter_change_logs(
    db: Session, data: bytes, name: str, report: "BackupRestoreReport",
    *, wipe: bool, current_user_id: int,
) -> None:
    """Log 'ultima modifica' dei parametri; SOLO con wipe=True. `user_id` è NOT NULL: se l'email non risolve, il log viene attribuito all'admin che esegue il restore (conteggiato nel report)."""
    if not wipe:
        report.files_skipped.append(name)
        report.by_file[name] = {"reason": "skipped (wipe=False)"}
        return

    _, rows = _read_sheet_rows(data, "ParameterChangeLogs")
    if rows is None:
        report.files_skipped.append(name)
        return

    user_id_by_email = _user_id_by_email(db)
    inserted = skipped = user_fallbacks = 0
    for row in rows:
        parameter_id_raw = row.get("Parameter ID") or ""
        resolved = resolve_parameter(db, parameter_id_raw)
        if resolved.parameter is None:
            report.errors.append({
                "_file": name,
                "reason": f"Parameter '{parameter_id_raw}' not found (no current id, no historical alias).",
            })
            skipped += 1
            continue
        user_id = user_id_by_email.get(row.get("User Email")) if row.get("User Email") else None
        if user_id is None:
            user_id = current_user_id
            user_fallbacks += 1
        db.add(models.ParameterChangeLog(
            parameter_id=resolved.parameter.id,
            user_id=user_id,
            change_note=row.get("Change Note") or "",
            created_at=row.get("Created At"),
        ))
        inserted += 1
    db.commit()
    report.files_processed.append(name)
    report.by_file[name] = {
        "inserted": inserted, "skipped_rows": skipped, "user_fallbacks": user_fallbacks,
    }


def _restore_parameter_flags(
    db: Session, data: bytes, name: str, report: "BackupRestoreReport",
    *, wipe: bool, current_user_id: int,
) -> None:
    """Flag (is_unsure, needs_review) per (lingua, parametro): upsert per chiave naturale, funziona con e senza wipe; gira dopo la fase languages/ e tocca solo i due flag, non le admin note."""
    _, rows = _read_sheet_rows(data, "ParameterFlags")
    if rows is None:
        report.files_skipped.append(name)
        return

    updated = created = skipped = 0
    for row in rows:
        language_id_raw = row.get("Language ID") or ""
        parameter_id_raw = row.get("Parameter ID") or ""
        language = resolve_language(db, language_id_raw).language
        parameter = resolve_parameter(db, parameter_id_raw).parameter
        if language is None or parameter is None:
            missing = f"language '{language_id_raw}'" if language is None else f"parameter '{parameter_id_raw}'"
            report.errors.append({"_file": name, "reason": f"Cannot restore flags: {missing} not found."})
            skipped += 1
            continue
        is_unsure = _yn_to_bool(row.get("Is Unsure"))
        needs_review = _yn_to_bool(row.get("Needs Review"))
        existing = db.query(models.LanguageParameterStatus).filter(
            models.LanguageParameterStatus.language_id == language.id,
            models.LanguageParameterStatus.parameter_id == parameter.id,
        ).first()
        if existing:
            existing.is_unsure = is_unsure
            existing.needs_review = needs_review
            updated += 1
        else:
            db.add(models.LanguageParameterStatus(
                language_id=language.id, parameter_id=parameter.id,
                is_unsure=is_unsure, needs_review=needs_review,
            ))
            created += 1
    db.commit()
    report.files_processed.append(name)
    report.by_file[name] = {"updated": updated, "created": created, "skipped_rows": skipped}


def _restore_aliases(
    db: Session, data: bytes, name: str, report: "BackupRestoreReport",
    *, wipe: bool, current_user_id: int,
) -> None:
    """Alias storici di lingue/parametri/question: upsert per `old_id` (UNIQUE), funziona con e senza wipe; scarta le righe il cui old_id coincide con un id corrente (alias morto)."""
    specs = [
        ("LanguageAliases", "Language ID", models.LanguageAlias, "language_id",
         models.Language, lambda value: resolve_language(db, value).language),
        ("ParameterAliases", "Parameter ID", models.ParameterAlias, "parameter_id",
         models.ParameterDef, lambda value: resolve_parameter(db, value).parameter),
        ("QuestionAliases", "Question ID", models.QuestionAlias, "question_id",
         models.Question, lambda value: resolve_question(db, value).question),
    ]

    any_sheet = False
    summary: Dict[str, Any] = {}
    for sheet, id_header, alias_model, fk_attr, entity_model, resolve in specs:
        _, rows = _read_sheet_rows(data, sheet)
        if rows is None:
            continue
        any_sheet = True
        inserted = updated = skipped = 0
        for row in rows:
            old_id = (str(row.get("Old ID")) if row.get("Old ID") is not None else "").strip()
            target_raw = (str(row.get(id_header)) if row.get(id_header) is not None else "").strip()
            if not old_id or not target_raw:
                continue
            entity = resolve(target_raw)
            if entity is None:
                report.errors.append({
                    "_file": name,
                    "reason": f"{sheet}: target '{target_raw}' for alias '{old_id}' not found.",
                })
                skipped += 1
                continue
            # old_id che coincide con un id corrente: alias morto, skip.
            if db.get(entity_model, old_id) is not None:
                skipped += 1
                continue
            existing = db.query(alias_model).filter(alias_model.old_id == old_id).first()
            if existing:
                setattr(existing, fk_attr, entity.id)
                if row.get("Created At"):
                    existing.created_at = row.get("Created At")
                updated += 1
            else:
                kwargs = {fk_attr: entity.id, "old_id": old_id}
                if row.get("Created At"):
                    kwargs["created_at"] = row.get("Created At")
                db.add(alias_model(**kwargs))
                inserted += 1
        summary[sheet] = {"inserted": inserted, "updated": updated, "skipped_rows": skipped}

    if not any_sheet:
        report.files_skipped.append(name)
        return
    db.commit()
    report.files_processed.append(name)
    report.by_file[name] = summary


def _restore_users(
    db: Session, data: bytes, name: str, report: "BackupRestoreReport",
    *, wipe: bool, current_user_id: int,
) -> None:
    """Utenti: upsert per email; niente hash password nel bundle (dettagli in DEV-NOTES.md); l'utente che esegue il restore non può essere disattivato/degradato dal bundle; ripristina anche l'assegnazione lingua→utente."""
    _, rows = _read_sheet_rows(data, "Users")
    if rows is None:
        report.files_skipped.append(name)
        return

    import secrets
    from auth import get_password_hash

    valid_roles = {"admin", "user", "public"}
    inserted = updated = assigned = skipped_assign = 0
    for row in rows:
        email = (str(row.get("Email")) if row.get("Email") is not None else "").strip()
        if not email:
            continue
        role = (str(row.get("Role")) if row.get("Role") is not None else "").strip() or "public"
        if role not in valid_roles:
            role = "public"
        is_active = _yn_to_bool(row.get("Is Active"))
        existing = db.query(models.User).filter(models.User.email == email).first()
        if existing:
            existing.name = row.get("Name") or None
            existing.surname = row.get("Surname") or None
            if existing.id != current_user_id:
                existing.role = role
                existing.is_active = is_active
            existing.terms_accepted = _yn_to_bool(row.get("Terms Accepted"))
            if row.get("Terms Accepted At"):
                existing.terms_accepted_at = row.get("Terms Accepted At")
            if row.get("Date Joined"):
                existing.date_joined = row.get("Date Joined")
            user = existing
            updated += 1
        else:
            user = models.User(
                email=email,
                hashed_password=get_password_hash(secrets.token_urlsafe(32)),
                name=row.get("Name") or None,
                surname=row.get("Surname") or None,
                role=role,
                is_active=is_active,
                terms_accepted=_yn_to_bool(row.get("Terms Accepted")),
                terms_accepted_at=row.get("Terms Accepted At"),
                date_joined=row.get("Date Joined"),
            )
            db.add(user)
            db.flush()
            inserted += 1

        assigned_languages_raw = str(row.get("Assigned Languages") or "")
        for language_id in [assigned_id.strip() for assigned_id in assigned_languages_raw.split(",") if assigned_id.strip()]:
            resolved = resolve_language(db, language_id)
            if resolved.language is None:
                report.errors.append({
                    "_file": name,
                    "reason": f"Assigned language '{language_id}' for user '{email}' not found.",
                })
                skipped_assign += 1
                continue
            resolved.language.assigned_user_id = user.id
            assigned += 1

    db.commit()
    report.files_processed.append(name)
    report.by_file[name] = {
        "inserted": inserted, "updated": updated,
        "languages_assigned": assigned, "assignments_skipped": skipped_assign,
    }


def _restore_legal_documents(
    db: Session, data: bytes, name: str, report: "BackupRestoreReport",
    *, wipe: bool, current_user_id: int,
) -> None:
    """Documenti legali + consensi: upsert per chiavi naturali, mai wipate; is_current rinormalizzato dopo l'upsert (dettagli in DEV-NOTES.md)."""
    _, rows = _read_sheet_rows(data, "LegalDocuments")
    if rows is None:
        report.files_skipped.append(name)
        return

    documents_inserted = documents_updated = 0
    for row in rows:
        doc_type = (str(row.get("Type")) if row.get("Type") is not None else "").strip()
        version = (str(row.get("Version")) if row.get("Version") is not None else "").strip()
        if not doc_type or not version:
            continue
        vexatious_clauses = None
        if row.get("Vexatious Clauses"):
            try:
                vexatious_clauses = json.loads(row["Vexatious Clauses"])
            except (ValueError, TypeError):
                vexatious_clauses = None
        existing = db.query(models.LegalDocument).filter(
            models.LegalDocument.type == doc_type,
            models.LegalDocument.version == version,
        ).first()
        if existing:
            # file_path/sha256 non cambiano mai per (type, version): il bundle aggiorna solo nota e clausole.
            existing.vexatious_clauses = vexatious_clauses
            existing.note = row.get("Note") or None
            documents_updated += 1
        else:
            db.add(models.LegalDocument(
                type=doc_type,
                version=version,
                file_path=os.path.basename(str(row.get("File Path") or "")),
                sha256=str(row.get("SHA256") or ""),
                published_at=row.get("Published At"),
                is_current=_yn_to_bool(row.get("Is Current")),
                vexatious_clauses=vexatious_clauses,
                note=row.get("Note") or None,
            ))
            documents_inserted += 1
    db.flush()

    # Rinormalizza is_current: per type, current = ultima published_at.
    doc_types = [type_row[0] for type_row in db.query(models.LegalDocument.type).distinct().all()]
    for doc_type in doc_types:
        documents_for_type = (
            db.query(models.LegalDocument)
            .filter(models.LegalDocument.type == doc_type)
            .order_by(models.LegalDocument.published_at.desc(),
                      models.LegalDocument.id.desc())
            .all()
        )
        for index, document in enumerate(documents_for_type):
            document.is_current = (index == 0)

    consents_inserted = consents_updated = consents_skipped = 0
    _, rows = _read_sheet_rows(data, "Consents")
    if rows is not None:
        user_id_by_email = _user_id_by_email(db)
        document_by_key = {
            (document.type, document.version): document for document in db.query(models.LegalDocument).all()
        }
        for row in rows:
            key = (
                (str(row.get("Document Type")) if row.get("Document Type") is not None else "").strip(),
                (str(row.get("Document Version")) if row.get("Document Version") is not None else "").strip(),
            )
            document = document_by_key.get(key)
            if document is None:
                report.errors.append({
                    "_file": name,
                    "reason": f"Consent references unknown document {key}; row skipped.",
                })
                consents_skipped += 1
                continue
            email = (str(row.get("User Email")) if row.get("User Email") is not None else "").strip()
            user_id = user_id_by_email.get(email) if email else None
            if email and user_id is None:
                report.errors.append({
                    "_file": name,
                    "reason": f"Consent user '{email}' not found in target DB; row skipped.",
                })
                consents_skipped += 1
                continue
            fields = {
                "ip_address": row.get("IP Address") or None,
                "user_agent": row.get("User Agent") or None,
                "method": str(row.get("Method") or ""),
                "vexatious_clauses_approved": _yn_to_bool(row.get("Vexatious Clauses Approved")),
                "revoked_at": row.get("Revoked At"),
                "revocation_reason": row.get("Revocation Reason") or None,
            }
            if row.get("Accepted At"):
                fields["accepted_at"] = row.get("Accepted At")
            if user_id is not None:
                existing = db.query(models.Consent).filter(
                    models.Consent.user_id == user_id,
                    models.Consent.legal_document_id == document.id,
                ).first()
            else:
                existing = db.query(models.Consent).filter(
                    models.Consent.user_id.is_(None),
                    models.Consent.legal_document_id == document.id,
                    models.Consent.accepted_at == row.get("Accepted At"),
                    models.Consent.method == fields["method"],
                ).first()
            if existing:
                for field_name, field_value in fields.items():
                    setattr(existing, field_name, field_value)
                consents_updated += 1
            else:
                db.add(models.Consent(user_id=user_id, legal_document_id=document.id, **fields))
                consents_inserted += 1

    db.commit()
    report.files_processed.append(name)
    report.by_file[name] = {
        "documents_inserted": documents_inserted, "documents_updated": documents_updated,
        "consents_inserted": consents_inserted, "consents_updated": consents_updated,
        "consents_skipped": consents_skipped,
    }


def _restore_entity_versions(
    db: Session, data: bytes, name: str, report: "BackupRestoreReport",
    *, wipe: bool, current_user_id: int,
) -> None:
    """History (JSON Lines, non xlsx: gli snapshot possono superare 32.767 char); insert-if-missing con dedupe su (entity_type, entity_id, operation, created_at), mai wipata."""
    from datetime import datetime

    try:
        jsonl_text = data.decode("utf-8")
    except UnicodeDecodeError as exception:
        report.errors.append({"_file": name, "reason": f"Not valid UTF-8: {exception}"})
        report.files_skipped.append(name)
        return

    user_id_by_email = _user_id_by_email(db)
    existing_keys = {
        (entity_version.entity_type, entity_version.entity_id, entity_version.operation, entity_version.created_at)
        for entity_version in db.query(
            models.EntityVersion.entity_type, models.EntityVersion.entity_id,
            models.EntityVersion.operation, models.EntityVersion.created_at,
        ).all()
    }

    inserted = already_present = bad_lines = 0
    for line in jsonl_text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            record = json.loads(line)
        except ValueError as exception:
            bad_lines += 1
            report.errors.append({"_file": name, "reason": f"Bad JSONL line: {exception}"})
            continue
        created_at = None
        if record.get("created_at"):
            try:
                created_at = datetime.fromisoformat(record["created_at"])
            except (ValueError, TypeError):
                created_at = None
        dedupe_key = (
            record.get("entity_type") or "",
            str(record.get("entity_id") or ""),
            record.get("operation") or "update",
            created_at,
        )
        if dedupe_key in existing_keys:
            already_present += 1
            continue
        existing_keys.add(dedupe_key)
        db.add(models.EntityVersion(
            entity_type=dedupe_key[0],
            entity_id=dedupe_key[1],
            snapshot=record.get("snapshot") if record.get("snapshot") is not None else {},
            operation=dedupe_key[2],
            source=record.get("source") or "manual",
            note=record.get("note"),
            user_id=user_id_by_email.get(record.get("user_email")) if record.get("user_email") else None,
            created_at=created_at,
        ))
        inserted += 1
    db.commit()
    report.files_processed.append(name)
    report.by_file[name] = {
        "inserted": inserted, "already_present": already_present, "bad_lines": bad_lines,
    }


_EXTRAS_HANDLERS = {
    "aliases.xlsx": _restore_aliases,
    "users.xlsx": _restore_users,
    "site_content.xlsx": _restore_site_content,
    "submissions.xlsx": _restore_submissions,
    "parameter_submissions.xlsx": _restore_parameter_submissions,
    "archived_questions.xlsx": _restore_archived_questions,
    "parameter_change_logs.xlsx": _restore_parameter_change_logs,
    "parameter_flags.xlsx": _restore_parameter_flags,
    "legal_documents.xlsx": _restore_legal_documents,
    "entity_versions.jsonl": _restore_entity_versions,
}
