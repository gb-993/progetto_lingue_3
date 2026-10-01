"""Import dei file Excel (dettagli in DEV-NOTES.md)."""
from __future__ import annotations
from dataclasses import dataclass, field, asdict
from typing import List, Optional, Dict, Set, Any, Tuple
from datetime import datetime
import io

from openpyxl import load_workbook
from openpyxl.worksheet.worksheet import Worksheet
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError, DataError

import models
from services.logic_parser import validate_expression, ParseException
from services.versioning import record_version
from services.language_alias import resolve_language
from services.question_alias import resolve_question
from services.parameter_alias import resolve_parameter


@dataclass
class ImportError:
    sheet: str
    row: int  # riga 1 = header
    column: Optional[str] = None
    value: Optional[str] = None
    reason: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class SheetSummary:
    rows_total: int = 0
    updated: int = 0
    inserted: int = 0
    skipped: int = 0
    errors: int = 0

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class ImportReport:
    sheets_processed: List[str] = field(default_factory=list)
    by_sheet: Dict[str, SheetSummary] = field(default_factory=dict)
    errors: List[ImportError] = field(default_factory=list)
    target_language_id: Optional[str] = None
    target_language_name: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "sheets_processed": self.sheets_processed,
            "by_sheet": {k: v.to_dict() for k, v in self.by_sheet.items()},
            "errors": [e.to_dict() for e in self.errors],
            "target_language_id": self.target_language_id,
            "target_language_name": self.target_language_name,
            "total_errors": len(self.errors),
        }


SCHEMA_SHEETS = ("Motivations", "Parameters", "Questions", "QuestionAllowedMotivations")
COMPILATION_SHEET = "Database_model"

# ordine di dipendenza fra gli sheet
SUPPORTED_SHEET_TYPES = (
    "Motivations",
    "Parameters",
    "Questions",
    "QuestionAllowedMotivations",
    "Languages",
    "Glossary",
    COMPILATION_SHEET,
)

# riconoscimento per colonne, se il nome della tab non torna
SHEET_SIGNATURES: Dict[str, Set[str]] = {
    COMPILATION_SHEET: {"Language", "Parameter_Label", "Question_ID", "Language_Answer"},
    "Motivations": {"Code"},
    "Parameters": {"ID", "Schema"},
    "Questions": {"ID", "Parameter ID", "Text"},
    "QuestionAllowedMotivations": {"Question ID", "Motivation Code"},
    "Languages": {"ID", "Name", "ISO code"},
    "Glossary": {"Word", "Description"},
}


def _str(v: Any) -> str:
    """Cella → stringa trim. None/vuoto → ''."""
    if v is None:
        return ""
    return str(v).strip()


def _bool_yn(v: Any) -> bool:
    """'Yes'/'No' → bool. Default False."""
    s = _str(v).lower()
    return s in ("yes", "y", "true", "1", "x")


def _none_if_empty(v: Any) -> Optional[str]:
    s = _str(v)
    return s if s else None


def _build_header_map(ws: Worksheet) -> Dict[str, int]:
    """Mappa nome colonna → indice (0-based) leggendo la riga 1."""
    header_row = next(ws.iter_rows(min_row=1, max_row=1, values_only=True))
    return {(_str(h)): i for i, h in enumerate(header_row) if _str(h)}


def _get(row: Tuple, header_map: Dict[str, int], col_name: str) -> Any:
    """Valore della colonna col_name, None se manca."""
    idx = header_map.get(col_name)
    if idx is None or idx >= len(row):
        return None
    return row[idx]


# riconoscimento degli sheet

def _detect_sheet_type(ws: Worksheet) -> Optional[str]:
    """Tipo di sheet dall'header, None se non si riconosce."""
    try:
        header_row = next(ws.iter_rows(min_row=1, max_row=1, values_only=True))
    except StopIteration:
        return None
    headers = {_str(h) for h in header_row if _str(h)}
    if not headers:
        return None
    for sheet_type in SUPPORTED_SHEET_TYPES:
        signature = SHEET_SIGNATURES.get(sheet_type)
        if signature and signature.issubset(headers):
            return sheet_type
    return None


def _resolve_sheets(wb) -> Dict[str, Worksheet]:
    """Tipo -> worksheet: prima per nome della tab, poi per header."""
    resolved: Dict[str, Worksheet] = {}
    for sheet_type in SUPPORTED_SHEET_TYPES:
        if sheet_type in wb.sheetnames:
            resolved[sheet_type] = wb[sheet_type]

    for ws in wb.worksheets:
        if ws.title in SUPPORTED_SHEET_TYPES:
            continue
        detected = _detect_sheet_type(ws)
        if detected and detected not in resolved:
            resolved[detected] = ws

    return resolved


def import_excel(
    db: Session,
    file_bytes: bytes,
    current_user_id: int,
    *,
    create_missing: bool = False,
) -> ImportReport:
    """Legge il file, processa gli sheet in ordine e ritorna il report."""
    try:
        wb = load_workbook(io.BytesIO(file_bytes), data_only=True)
    except Exception as e:
        report = ImportReport()
        report.errors.append(ImportError(
            sheet="(file)", row=0, reason=f"File not readable: {e}"
        ))
        return report

    report = ImportReport()

    # id falliti: bloccano le righe che dipendono da loro
    failed_motivation_codes: Set[str] = set()
    failed_parameter_ids: Set[str] = set()
    failed_question_ids: Set[str] = set()

    sheets = _resolve_sheets(wb)

    def _run(sheet_type: str, fn) -> None:
        ws = sheets.get(sheet_type)
        if ws is None:
            return
        fn(ws)
        try:
            db.commit()
        except Exception as e:
            db.rollback()
            report.errors.append(ImportError(sheet=sheet_type, row=0, reason=f"Commit failed: {e}"))

    _run("Motivations", lambda ws: _import_motivations(
        db, ws, report, failed_motivation_codes,
        user_id=current_user_id, create_missing=create_missing))

    _run("Parameters", lambda ws: _import_parameters(
        db, ws, report, current_user_id, failed_parameter_ids,
        create_missing=create_missing))

    _run("Questions", lambda ws: _import_questions(
        db, ws, report, current_user_id,
        failed_parameter_ids, failed_question_ids,
        create_missing=create_missing))

    _run("QuestionAllowedMotivations", lambda ws: _import_qam(
        db, ws, report, failed_motivation_codes, failed_question_ids))

    # sheet presenti solo nei backup-zip
    _run("Languages", lambda ws: _import_languages_metadata(db, ws, report))
    _run("Glossary", lambda ws: _import_glossary(db, ws, report))

    _run(COMPILATION_SHEET, lambda ws: _import_compilation(
        db, ws, report, failed_question_ids))

    return report


def _safe_apply(db: Session, fn) -> Tuple[bool, Optional[str]]:
    """Esegue fn() in un savepoint; se fallisce annulla solo quella riga."""
    sp = db.begin_nested()
    try:
        fn()
        db.flush()
        sp.commit()
        return True, None
    except (IntegrityError, DataError) as e:
        sp.rollback()
        return False, _format_db_error(e)
    except Exception as e:
        sp.rollback()
        return False, str(e)


def _format_db_error(e: Exception) -> str:
    msg = str(getattr(e, "orig", e))
    if len(msg) > 200:
        msg = msg[:200] + "…"
    return msg


# Motivations

def _import_motivations(db: Session, ws: Worksheet, report: ImportReport,
                        failed_codes: Set[str], user_id: Optional[int] = None,
                        *, create_missing: bool = False) -> None:
    summary = SheetSummary()
    report.sheets_processed.append("Motivations")
    report.by_sheet["Motivations"] = summary

    hmap = _build_header_map(ws)
    if "Code" not in hmap:
        report.errors.append(ImportError(sheet="Motivations", row=1,
                                         reason="Missing 'Code' column"))
        return

    # confronto case-insensitive
    by_code = {m.code.upper(): m for m in db.query(models.Motivation).all()}

    for ridx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        if all(v is None or _str(v) == "" for v in row):
            continue
        summary.rows_total += 1

        code = _str(_get(row, hmap, "Code"))
        if not code:
            summary.errors += 1
            report.errors.append(ImportError(
                sheet="Motivations", row=ridx, column="Code",
                reason="Empty Code, row skipped"
            ))
            continue

        code_key = code.upper()
        existing = by_code.get(code_key)
        label = _str(_get(row, hmap, "Label"))

        if not existing:
            if not create_missing:
                summary.errors += 1
                failed_codes.add(code_key)
                report.errors.append(ImportError(
                    sheet="Motivations", row=ridx, column="Code", value=code,
                    reason=f"Motivation '{code}' does not exist in the DB. Create it via the UI before importing."
                ))
                continue
            def apply_create():
                m = models.Motivation(code=code, label=label or "")
                db.add(m)
                db.flush()
                by_code[code_key] = m

            ok, err = _safe_apply(db, apply_create)
            if ok:
                summary.inserted += 1
                record_version(db, by_code[code_key], operation="create",
                               source="backup_restore", user_id=user_id,
                               note="Backup restore")
            else:
                summary.errors += 1
                failed_codes.add(code_key)
                report.errors.append(ImportError(
                    sheet="Motivations", row=ridx, value=code, reason=err
                ))
            continue

        def apply():
            existing.label = label or existing.label

        ok, err = _safe_apply(db, apply)
        if ok:
            summary.updated += 1
            record_version(db, existing, operation="update", source="excel_import",
                           user_id=user_id, note="Import Excel")
        else:
            summary.errors += 1
            failed_codes.add(code_key)
            report.errors.append(ImportError(
                sheet="Motivations", row=ridx, value=code, reason=err
            ))


# Parameters

PARAM_FIELDS = (
    ("Name", "name", _str),
    ("Schema", "schema", _str),
    ("Type", "param_type", _str),
    ("Level", "level_of_comparison", _str),
    ("Short Description", "short_description", _str),
    ("Long Description", "long_description", _str),
    ("Implicational Condition", "implicational_condition", _none_if_empty),
    ("Explanation of Implicational Condition", "description_of_the_implicational_condition", _str),
)


def _import_parameters(db: Session, ws: Worksheet, report: ImportReport,
                       user_id: int, failed_ids: Set[str],
                       *, create_missing: bool = False) -> None:
    summary = SheetSummary()
    report.sheets_processed.append("Parameters")
    report.by_sheet["Parameters"] = summary

    hmap = _build_header_map(ws)
    if "ID" not in hmap:
        report.errors.append(ImportError(sheet="Parameters", row=1,
                                         reason="Missing 'ID' column"))
        return

    # confronto case-insensitive
    by_id = {p.id.upper(): p for p in db.query(models.ParameterDef).all()}

    for ridx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        if all(v is None or _str(v) == "" for v in row):
            continue
        summary.rows_total += 1

        pid = _str(_get(row, hmap, "ID"))
        if not pid:
            summary.errors += 1
            report.errors.append(ImportError(
                sheet="Parameters", row=ridx, column="ID",
                reason="Empty ID, row skipped"
            ))
            continue

        pid_key = pid.upper()
        existing = by_id.get(pid_key)
        if existing is None:
            # id rinominato dopo l'export: cerca negli alias
            resolved = resolve_parameter(db, pid)
            if resolved.parameter is not None:
                existing = resolved.parameter
                by_id[pid_key] = existing

        cond_raw = _none_if_empty(_get(row, hmap, "Implicational Condition"))
        if cond_raw:
            try:
                validate_expression(cond_raw)
            except ParseException as e:
                summary.errors += 1
                failed_ids.add(pid_key)
                report.errors.append(ImportError(
                    sheet="Parameters", row=ridx,
                    column="Implicational Condition", value=cond_raw,
                    reason=f"Wrong formula syntax: {e}"
                ))
                continue

        # nuovo parametro (solo con create_missing)
        if existing is None:
            if not create_missing:
                summary.errors += 1
                failed_ids.add(pid_key)
                report.errors.append(ImportError(
                    sheet="Parameters", row=ridx, column="ID", value=pid,
                    reason=f"Parameter '{pid}' does not exist in the DB. Create it via the UI before importing."
                ))
                continue

            new_position = _get(row, hmap, "Position")
            try:
                new_position = int(new_position) if new_position not in (None, "") else 0
            except (TypeError, ValueError):
                new_position = 0
            new_is_active = _bool_yn(_get(row, hmap, "Is Active"))

            def apply_create():
                kwargs = {"id": pid, "position": new_position, "is_active": new_is_active}
                for col_name, attr_name, parser in PARAM_FIELDS:
                    kwargs[attr_name] = parser(_get(row, hmap, col_name))
                p = models.ParameterDef(**kwargs)
                db.add(p)
                db.flush()
                by_id[pid_key] = p

            ok, err = _safe_apply(db, apply_create)
            if ok:
                summary.inserted += 1
                record_version(db, by_id[pid_key], operation="create",
                               source="backup_restore", user_id=user_id,
                               note="Backup restore")
            else:
                summary.errors += 1
                failed_ids.add(pid_key)
                report.errors.append(ImportError(
                    sheet="Parameters", row=ridx, value=pid, reason=err
                ))
            continue

        # parametro esistente
        old_snapshot = {f[1]: getattr(existing, f[1]) for f in PARAM_FIELDS}
        old_position = existing.position
        old_is_active = existing.is_active

        new_position = _get(row, hmap, "Position")
        try:
            new_position = int(new_position) if new_position not in (None, "") else existing.position
        except (TypeError, ValueError):
            new_position = existing.position

        new_is_active = _bool_yn(_get(row, hmap, "Is Active"))

        def apply():
            for col_name, attr_name, parser in PARAM_FIELDS:
                val = _get(row, hmap, col_name)
                setattr(existing, attr_name, parser(val))
            existing.position = new_position
            existing.is_active = new_is_active

        ok, err = _safe_apply(db, apply)
        if not ok:
            summary.errors += 1
            failed_ids.add(pid_key)
            report.errors.append(ImportError(
                sheet="Parameters", row=ridx, value=pid, reason=err
            ))
            continue

        # differenze per il changelog
        diff_parts = []
        for f in PARAM_FIELDS:
            attr = f[1]
            if old_snapshot[attr] != getattr(existing, attr):
                diff_parts.append(attr)
        if old_position != new_position:
            diff_parts.append("position")
        if old_is_active != new_is_active:
            diff_parts.append("is_active")

        if diff_parts:
            log = models.ParameterChangeLog(
                parameter_id=existing.id, user_id=user_id,
                change_note=f"[Excel import] Updated: {', '.join(diff_parts)}"
            )
            db.add(log)

        record_version(db, existing, operation="update", source="excel_import",
                       user_id=user_id,
                       note=f"Import Excel ({', '.join(diff_parts) or 'no changes'})")
        summary.updated += 1


# Questions

QUESTION_FIELDS = (
    ("Text", "text", _str),
    ("Template Type", "template_type", _str),
    ("Instruction", "instruction", _none_if_empty),
    ("Instruction YES", "instruction_yes", _none_if_empty),
    ("Instruction NO", "instruction_no", _none_if_empty),
    ("Example YES", "example_yes", _none_if_empty),
    ("Help Info", "help_info", _none_if_empty),
)


def _import_questions(db: Session, ws: Worksheet, report: ImportReport,
                      user_id: int, failed_param_ids: Set[str],
                      failed_question_ids: Set[str],
                      *, create_missing: bool = False) -> None:
    summary = SheetSummary()
    report.sheets_processed.append("Questions")
    report.by_sheet["Questions"] = summary

    hmap = _build_header_map(ws)
    if "ID" not in hmap:
        report.errors.append(ImportError(sheet="Questions", row=1,
                                         reason="Missing 'ID' column"))
        return

    # confronto case-insensitive
    by_id = {q.id.upper(): q for q in db.query(models.Question).all()}
    param_id_by_upper = {p.id.upper(): p.id for p in db.query(models.ParameterDef.id).all()}

    for ridx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        if all(v is None or _str(v) == "" for v in row):
            continue
        summary.rows_total += 1

        qid = _str(_get(row, hmap, "ID"))
        if not qid:
            summary.errors += 1
            report.errors.append(ImportError(
                sheet="Questions", row=ridx, column="ID",
                reason="Empty ID, row skipped"
            ))
            continue

        qid_key = qid.upper()
        existing = by_id.get(qid_key)
        if existing is None:
            # id rinominato dopo l'export: cerca negli alias
            resolved = resolve_question(db, qid)
            if resolved.question is not None:
                existing = resolved.question
                by_id[qid_key] = existing
        new_param_id = _str(_get(row, hmap, "Parameter ID"))
        new_param_id_key = new_param_id.upper() if new_param_id else ""
        canonical_new_param_id = param_id_by_upper.get(new_param_id_key) if new_param_id else None
        if new_param_id and canonical_new_param_id is None:
            # parametro rinominato: cerca negli alias
            resolved_p = resolve_parameter(db, new_param_id)
            if resolved_p.parameter is not None:
                canonical_new_param_id = resolved_p.parameter.id
                param_id_by_upper[new_param_id_key] = canonical_new_param_id

        # nuova question (solo con create_missing)
        if existing is None:
            if not create_missing:
                summary.errors += 1
                failed_question_ids.add(qid_key)
                report.errors.append(ImportError(
                    sheet="Questions", row=ridx, column="ID", value=qid,
                    reason=f"Question '{qid}' does not exist in the DB. Create it via the UI before importing."
                ))
                continue
            if not new_param_id:
                summary.errors += 1
                failed_question_ids.add(qid_key)
                report.errors.append(ImportError(
                    sheet="Questions", row=ridx, column="Parameter ID", value=qid,
                    reason="Empty Parameter ID for new question"
                ))
                continue
            if canonical_new_param_id is None:
                summary.errors += 1
                failed_question_ids.add(qid_key)
                report.errors.append(ImportError(
                    sheet="Questions", row=ridx, column="Parameter ID", value=new_param_id,
                    reason=f"Parameter '{new_param_id}' does not exist"
                ))
                continue

            new_stop = _bool_yn(_get(row, hmap, "Is Stop Question"))
            new_active = _bool_yn(_get(row, hmap, "Is Active"))

            def apply_create():
                kwargs = {
                    "id": qid, "parameter_id": canonical_new_param_id,
                    "is_stop_question": new_stop, "is_active": new_active,
                }
                for col_name, attr_name, parser in QUESTION_FIELDS:
                    kwargs[attr_name] = parser(_get(row, hmap, col_name))
                q = models.Question(**kwargs)
                db.add(q)
                db.flush()
                by_id[qid_key] = q

            ok, err = _safe_apply(db, apply_create)
            if ok:
                summary.inserted += 1
                record_version(db, by_id[qid_key], operation="create",
                               source="backup_restore", user_id=user_id,
                               note="Backup restore")
            else:
                summary.errors += 1
                failed_question_ids.add(qid_key)
                report.errors.append(ImportError(
                    sheet="Questions", row=ridx, value=qid, reason=err
                ))
            continue

        # cambio di parametro?
        parent_changing = bool(new_param_id) and new_param_id_key != existing.parameter_id.upper()
        if parent_changing:
            if new_param_id_key in failed_param_ids:
                summary.errors += 1
                failed_question_ids.add(qid_key)
                report.errors.append(ImportError(
                    sheet="Questions", row=ridx, column="Parameter ID", value=new_param_id,
                    reason=f"Parameter '{new_param_id}' failed during import (upstream error)"
                ))
                continue
            if canonical_new_param_id is None:
                summary.errors += 1
                failed_question_ids.add(qid_key)
                report.errors.append(ImportError(
                    sheet="Questions", row=ridx, column="Parameter ID", value=new_param_id,
                    reason=f"Parameter '{new_param_id}' does not exist"
                ))
                continue

        old_param_id = existing.parameter_id
        old_snapshot = {f[1]: getattr(existing, f[1]) for f in QUESTION_FIELDS}
        old_stop = existing.is_stop_question
        old_active = existing.is_active

        new_stop = _bool_yn(_get(row, hmap, "Is Stop Question"))
        new_active = _bool_yn(_get(row, hmap, "Is Active"))

        def apply():
            if parent_changing and canonical_new_param_id is not None:
                existing.parameter_id = canonical_new_param_id
            for col_name, attr_name, parser in QUESTION_FIELDS:
                setattr(existing, attr_name, parser(_get(row, hmap, col_name)))
            existing.is_stop_question = new_stop
            existing.is_active = new_active

        ok, err = _safe_apply(db, apply)
        if not ok:
            summary.errors += 1
            failed_question_ids.add(qid_key)
            report.errors.append(ImportError(
                sheet="Questions", row=ridx, value=qid, reason=err
            ))
            continue

        # differenze nel changelog del parametro
        diff_parts = []
        for f in QUESTION_FIELDS:
            if old_snapshot[f[1]] != getattr(existing, f[1]):
                diff_parts.append(f[1])
        if old_stop != new_stop:
            diff_parts.append("is_stop_question")
        if old_active != new_active:
            diff_parts.append("is_active")
        if old_param_id != existing.parameter_id:
            diff_parts.append("parameter_id")

        if diff_parts:
            log = models.ParameterChangeLog(
                parameter_id=existing.parameter_id, user_id=user_id,
                change_note=f"[Excel import] [Question {qid}] Updated: {', '.join(diff_parts)}"
            )
            db.add(log)

        record_version(db, existing, operation="update", source="excel_import",
                       user_id=user_id,
                       note=f"Import Excel ({', '.join(diff_parts) or 'no changes'})")
        summary.updated += 1


# QuestionAllowedMotivations

def _import_qam(db: Session, ws: Worksheet, report: ImportReport,
                failed_motivation_codes: Set[str],
                failed_question_ids: Set[str]) -> None:
    summary = SheetSummary()
    report.sheets_processed.append("QuestionAllowedMotivations")
    report.by_sheet["QuestionAllowedMotivations"] = summary

    hmap = _build_header_map(ws)
    if "Question ID" not in hmap or "Motivation Code" not in hmap:
        report.errors.append(ImportError(
            sheet="QuestionAllowedMotivations", row=1,
            reason="Required columns: 'Question ID', 'Motivation Code'"
        ))
        return

    # confronto case-insensitive
    by_qid = {q.id.upper(): q for q in db.query(models.Question).all()}
    by_code = {m.code.upper(): m for m in db.query(models.Motivation).all()}

    # per ogni question del file: via i link vecchi, dentro i nuovi
    questions_seen: Set[str] = set()
    pairs_to_create: List[Tuple[str, int]] = []

    for ridx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        if all(v is None or _str(v) == "" for v in row):
            continue
        summary.rows_total += 1

        qid = _str(_get(row, hmap, "Question ID"))
        code = _str(_get(row, hmap, "Motivation Code"))

        if not qid or not code:
            summary.errors += 1
            report.errors.append(ImportError(
                sheet="QuestionAllowedMotivations", row=ridx,
                reason="Empty Question ID or Motivation Code"
            ))
            continue

        qid_key = qid.upper()
        code_key = code.upper()

        if qid_key in failed_question_ids:
            summary.errors += 1
            report.errors.append(ImportError(
                sheet="QuestionAllowedMotivations", row=ridx,
                column="Question ID", value=qid,
                reason=f"Question '{qid}' failed during import (upstream error)"
            ))
            continue
        question_db = by_qid.get(qid_key)
        if question_db is None:
            # question rinominata: cerca negli alias
            resolved = resolve_question(db, qid)
            if resolved.question is not None:
                question_db = resolved.question
                by_qid[qid_key] = question_db
        if question_db is None:
            summary.errors += 1
            report.errors.append(ImportError(
                sheet="QuestionAllowedMotivations", row=ridx,
                column="Question ID", value=qid,
                reason=f"Question '{qid}' does not exist"
            ))
            continue

        if code_key in failed_motivation_codes:
            summary.errors += 1
            report.errors.append(ImportError(
                sheet="QuestionAllowedMotivations", row=ridx,
                column="Motivation Code", value=code,
                reason=f"Motivation '{code}' failed during import (upstream error)"
            ))
            continue
        motivation_db = by_code.get(code_key)
        if motivation_db is None:
            summary.errors += 1
            report.errors.append(ImportError(
                sheet="QuestionAllowedMotivations", row=ridx,
                column="Motivation Code", value=code,
                reason=f"Motivation '{code}' does not exist"
            ))
            continue

        questions_seen.add(question_db.id)
        pairs_to_create.append((question_db.id, motivation_db.id))

    if questions_seen:
        db.query(models.QuestionAllowedMotivation).filter(
            models.QuestionAllowedMotivation.question_id.in_(questions_seen)
        ).delete(synchronize_session=False)
        db.flush()

        for qid, mid in pairs_to_create:
            db.add(models.QuestionAllowedMotivation(question_id=qid, motivation_id=mid))
            summary.inserted += 1


# Database_model: compilation di una lingua

def _split_lines(v: Any) -> List[str]:
    s = _str(v)
    if not s:
        return []
    return [line.strip() for line in s.replace("\r\n", "\n").replace("\r", "\n").split("\n")]


def _import_compilation(db: Session, ws: Worksheet, report: ImportReport,
                        failed_question_ids: Set[str]) -> None:
    summary = SheetSummary()
    report.sheets_processed.append(COMPILATION_SHEET)
    report.by_sheet[COMPILATION_SHEET] = summary

    hmap = _build_header_map(ws)
    required = ["Language", "Parameter_Label", "Question_ID", "Language_Answer"]
    missing = [c for c in required if c not in hmap]
    if missing:
        report.errors.append(ImportError(
            sheet=COMPILATION_SHEET, row=1,
            reason=f"Missing columns: {', '.join(missing)}"
        ))
        return

    # la lingua viene dalla colonna "Language" (deve essere unica)
    lang_values: Set[str] = set()
    rows = []
    for ridx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        if all(v is None or _str(v) == "" for v in row):
            continue
        rows.append((ridx, row))
        lv = _str(_get(row, hmap, "Language"))
        if lv:
            lang_values.add(lv)

    if not rows:
        return
    if len(lang_values) != 1:
        report.errors.append(ImportError(
            sheet=COMPILATION_SHEET, row=0,
            reason=f"The file must contain a single language. Found: {sorted(lang_values)}"
        ))
        return

    lang_name = next(iter(lang_values))
    lang = db.query(models.Language).filter(
        models.Language.name_full == lang_name
    ).first()
    if not lang:
        report.errors.append(ImportError(
            sheet=COMPILATION_SHEET, row=0, value=lang_name,
            reason=f"Language '{lang_name}' not found (search by name_full)"
        ))
        return

    report.target_language_id = lang.id
    report.target_language_name = lang.name_full

    # cancellazione una per una: il bulk delete salta il cascade (vedi DEV-NOTES.md)
    old_answer_ids = [
        a_id for (a_id,) in db.query(models.Answer.id).filter(
            models.Answer.language_id == lang.id
        ).all()
    ]
    if old_answer_ids:
        db.query(models.Example).filter(
            models.Example.answer_id.in_(old_answer_ids)
        ).delete(synchronize_session=False)
        db.query(models.AnswerMotivation).filter(
            models.AnswerMotivation.answer_id.in_(old_answer_ids)
        ).delete(synchronize_session=False)
        db.query(models.Answer).filter(
            models.Answer.id.in_(old_answer_ids)
        ).delete(synchronize_session=False)
    # azzera solo le note, per non perdere is_unsure
    db.query(models.LanguageParameterStatus).filter(
        models.LanguageParameterStatus.language_id == lang.id
    ).update({"admin_note": None}, synchronize_session=False)
    db.flush()

    # question e motivation, confronto case-insensitive
    q_id_by_upper = {q.id.upper(): q.id for q in db.query(models.Question.id).all()}
    mot_by_code = {m.code.upper(): m for m in db.query(models.Motivation).all()}
    param_id_by_upper = {p.id.upper(): p.id for p in db.query(models.ParameterDef.id).all()}

    admin_notes_by_pid: dict[str, str] = {}

    for ridx, row in rows:
        summary.rows_total += 1

        qid = _str(_get(row, hmap, "Question_ID"))
        if not qid:
            summary.errors += 1
            report.errors.append(ImportError(
                sheet=COMPILATION_SHEET, row=ridx, column="Question_ID",
                reason="Empty Question_ID"
            ))
            continue

        qid_key = qid.upper()
        if qid_key in failed_question_ids:
            summary.errors += 1
            report.errors.append(ImportError(
                sheet=COMPILATION_SHEET, row=ridx, column="Question_ID", value=qid,
                reason=f"Question '{qid}' failed during import (upstream error)"
            ))
            continue
        canonical_qid = q_id_by_upper.get(qid_key)
        if canonical_qid is None:
            # question rinominata: cerca negli alias
            resolved = resolve_question(db, qid)
            if resolved.question is not None:
                canonical_qid = resolved.question.id
                q_id_by_upper[qid_key] = canonical_qid
        if canonical_qid is None:
            summary.errors += 1
            report.errors.append(ImportError(
                sheet=COMPILATION_SHEET, row=ridx, column="Question_ID", value=qid,
                reason=f"Question '{qid}' does not exist"
            ))
            continue
        qid = canonical_qid

        raw_ans = _str(_get(row, hmap, "Language_Answer")).upper()
        if raw_ans in ("YES", "Y"):
            response = "yes"
        elif raw_ans in ("NO", "N"):
            response = "no"
        elif raw_ans in ("UNSURE", "U", "?"):
            response = "unsure"
        elif raw_ans in ("MISSING", "M"):
            # missing = dato non disponibile, esempi non obbligatori
            response = "missing"
        elif raw_ans == "":
            # risposta vuota: non è un errore
            summary.skipped += 1
            continue
        else:
            summary.errors += 1
            report.errors.append(ImportError(
                sheet=COMPILATION_SHEET, row=ridx, column="Language_Answer", value=raw_ans,
                reason=f"Invalid value (expected YES/NO/UNSURE/MISSING/empty): '{raw_ans}'"
            ))
            continue

        comments = _str(_get(row, hmap, "Language_Comments"))

        ex_texts = _split_lines(_get(row, hmap, "Language_Examples"))
        translit_lines = _split_lines(_get(row, hmap, "Language_Example_Transliteration"))
        gloss_lines = _split_lines(_get(row, hmap, "Language_Example_Gloss"))
        transl_lines = _split_lines(_get(row, hmap, "Language_Example_Translation"))
        ref_lines = _split_lines(_get(row, hmap, "Language_References"))
        # colonna opzionale (manca nei file vecchi)
        is_test_lines = _split_lines(_get(row, hmap, "Language_Example_Is_Test"))

        # codice sconosciuto: saltato, il resto entra comunque
        mot_codes_raw = _str(_get(row, hmap, "Motivations"))
        mot_codes_to_apply: list[int] = []
        if mot_codes_raw:
            for token in mot_codes_raw.replace(",", ";").split(";"):
                code = token.strip()
                if not code:
                    continue
                m = mot_by_code.get(code.upper())
                if m is None:
                    report.errors.append(ImportError(
                        sheet=COMPILATION_SHEET, row=ridx, column="Motivations", value=code,
                        reason=f"Motivation code '{code}' not found"
                    ))
                    continue
                mot_codes_to_apply.append(m.id)

        # la admin note è del parametro: si applica una volta sola
        note_cell = _str(_get(row, hmap, "Admin_Note"))
        param_label = _str(_get(row, hmap, "Parameter_Label"))
        canonical_pid = param_id_by_upper.get(param_label.upper()) if param_label else None
        if note_cell and canonical_pid is not None:
            admin_notes_by_pid[canonical_pid] = note_cell

        def apply(mot_ids=mot_codes_to_apply):
            answer = models.Answer(
                language_id=lang.id, question_id=qid,
                response_text=response, comments=comments or None,
                status="pending",
            )
            db.add(answer)
            db.flush()  # per ottenere answer.id

            for i, txt in enumerate(ex_texts):
                if not txt and not (
                    (translit_lines[i] if i < len(translit_lines) else "") or
                    (gloss_lines[i] if i < len(gloss_lines) else "") or
                    (transl_lines[i] if i < len(transl_lines) else "") or
                    (ref_lines[i] if i < len(ref_lines) else "")
                ):
                    continue
                ex = models.Example(
                    answer_id=answer.id,
                    number=str(i + 1),
                    textarea=txt or None,
                    transliteration=(translit_lines[i] if i < len(translit_lines) else None) or None,
                    gloss=(gloss_lines[i] if i < len(gloss_lines) else None) or None,
                    translation=(transl_lines[i] if i < len(transl_lines) else None) or None,
                    reference=(ref_lines[i] if i < len(ref_lines) else None) or None,
                    is_test=(is_test_lines[i] if i < len(is_test_lines) else "").strip().upper()
                            in ("TEST", "YES", "Y", "TRUE", "1", "X"),
                )
                db.add(ex)

            # evita codici ripetuti nella cella
            for mid in set(mot_ids):
                db.add(models.AnswerMotivation(answer_id=answer.id, motivation_id=mid))

        ok, err = _safe_apply(db, apply)
        if ok:
            summary.inserted += 1
        else:
            summary.errors += 1
            report.errors.append(ImportError(
                sheet=COMPILATION_SHEET, row=ridx, value=qid, reason=err
            ))

    for pid, note in admin_notes_by_pid.items():
        status = db.query(models.LanguageParameterStatus).filter(
            models.LanguageParameterStatus.language_id == lang.id,
            models.LanguageParameterStatus.parameter_id == pid,
        ).first()
        if status is None:
            db.add(models.LanguageParameterStatus(
                language_id=lang.id,
                parameter_id=pid,
                admin_note=note,
                is_unsure=False,
            ))
        else:
            status.admin_note = note


# Languages: aggiorna o aggiunge, non cancella

def _bool_yn_or_none(v: Any) -> Optional[bool]:
    if v is None:
        return None
    s = _str(v).lower()
    if s in ("yes", "y", "true", "1"):
        return True
    if s in ("no", "n", "false", "0"):
        return False
    return None


def _float_or_none(v: Any) -> Optional[float]:
    if v is None or _str(v) == "":
        return None
    try:
        return float(v)
    except (ValueError, TypeError):
        return None


def _import_languages_metadata(db: Session, ws: Worksheet, report: ImportReport) -> None:
    summary = SheetSummary()
    report.sheets_processed.append("Languages")
    report.by_sheet["Languages"] = summary

    hmap = _build_header_map(ws)
    if "ID" not in hmap or "Name" not in hmap:
        report.errors.append(ImportError(
            sheet="Languages", row=1,
            reason="Columns 'ID' and 'Name' are required."
        ))
        return

    # nuove lingue in fondo (position max + 1)

    for ridx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        if all(v is None or _str(v) == "" for v in row):
            continue
        summary.rows_total += 1

        lid = _str(_get(row, hmap, "ID"))
        name = _str(_get(row, hmap, "Name"))
        if not lid:
            summary.errors += 1
            report.errors.append(ImportError(
                sheet="Languages", row=ridx, column="ID", reason="Empty ID"
            ))
            continue
        if not name:
            summary.errors += 1
            report.errors.append(ImportError(
                sheet="Languages", row=ridx, column="Name", value=lid, reason="Empty Name"
            ))
            continue

        # accetta anche gli status vecchi
        status = models.normalize_language_status(_str(_get(row, hmap, "Status")))

        top_str = _str(_get(row, hmap, "Top-level family")) or ""
        fam_str = _str(_get(row, hmap, "Family")) or ""
        grp_str = _str(_get(row, hmap, "Group")) or ""

        # nome -> FK come in languages.py; se non c'è resta NULL
        top_obj = db.query(models.TopFamily).filter(models.TopFamily.name == top_str).first() if top_str else None
        fam_obj = db.query(models.Family).filter(models.Family.name == fam_str).first() if fam_str else None
        grp_obj = db.query(models.Group).filter(models.Group.name == grp_str).first() if grp_str else None

        fields = {
            "name_full": name,
            "top_level_family": top_str,
            "family": fam_str,
            "grp": grp_str,
            "top_family_id": top_obj.id if top_obj else None,
            "family_id": fam_obj.id if fam_obj else None,
            "group_id": grp_obj.id if grp_obj else None,
            "isocode": _str(_get(row, hmap, "ISO code")) or "",
            "glottocode": _str(_get(row, hmap, "Glottocode")) or "",
            "location": _str(_get(row, hmap, "Location")) or "",
            "latitude": _float_or_none(_get(row, hmap, "Latitude")),
            "longitude": _float_or_none(_get(row, hmap, "Longitude")),
            "supervisor": _str(_get(row, hmap, "Supervisor")) or "",
            "informant": _str(_get(row, hmap, "Informant")) or "",
            "historical_language": _bool_yn_or_none(_get(row, hmap, "Historical")) or False,
            "source": _str(_get(row, hmap, "Source")) or "",
            "status": status,
        }

        # id vecchio di una lingua rinominata: cerca negli alias
        resolved = resolve_language(db, lid, file_glottocode=fields["glottocode"])
        if resolved.glottocode_mismatch:
            summary.errors += 1
            report.errors.append(ImportError(
                sheet="Languages", row=ridx, value=lid,
                reason=resolved.glottocode_mismatch,
            ))
            continue
        existing = resolved.language

        def apply():
            if existing is None:
                last = db.query(models.Language).order_by(
                    models.Language.position.desc()
                ).first()
                pos = (last.position + 1) if last else 1
                lang = models.Language(id=lid, position=pos, **fields)
                db.add(lang)
            else:
                # existing.id resta quello attuale
                for k, v in fields.items():
                    setattr(existing, k, v)

        ok, err = _safe_apply(db, apply)
        if ok:
            if existing is None:
                summary.inserted += 1
            else:
                summary.updated += 1
        else:
            summary.errors += 1
            report.errors.append(ImportError(
                sheet="Languages", row=ridx, value=lid, reason=err
            ))


# Glossary

def _import_glossary(db: Session, ws: Worksheet, report: ImportReport) -> None:
    summary = SheetSummary()
    report.sheets_processed.append("Glossary")
    report.by_sheet["Glossary"] = summary

    hmap = _build_header_map(ws)
    if "Word" not in hmap or "Description" not in hmap:
        report.errors.append(ImportError(
            sheet="Glossary", row=1,
            reason="Columns 'Word' and 'Description' are required."
        ))
        return

    for ridx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        if all(v is None or _str(v) == "" for v in row):
            continue
        summary.rows_total += 1

        word = _str(_get(row, hmap, "Word"))
        desc = _str(_get(row, hmap, "Description"))
        if not word:
            summary.errors += 1
            report.errors.append(ImportError(
                sheet="Glossary", row=ridx, column="Word", reason="Empty Word"
            ))
            continue
        if not desc:
            summary.errors += 1
            report.errors.append(ImportError(
                sheet="Glossary", row=ridx, column="Description", value=word,
                reason="Empty Description"
            ))
            continue

        existing = db.query(models.Glossary).filter(models.Glossary.word == word).first()

        def apply():
            if existing is None:
                db.add(models.Glossary(word=word, description=desc))
            else:
                existing.description = desc

        ok, err = _safe_apply(db, apply)
        if ok:
            if existing is None:
                summary.inserted += 1
            else:
                summary.updated += 1
        else:
            summary.errors += 1
            report.errors.append(ImportError(
                sheet="Glossary", row=ridx, value=word, reason=err
            ))
