"""
Servizio di export Excel.

Tre workbook builder:
  - build_language_workbook(db, lang, is_admin): per admin produce 7 sheet
    (3 vecchi formato + 4 schema), per user normale solo "Examples".
  - build_language_list_workbook(db, languages): metadati delle lingue selezionate.
  - build_schema_workbook(db): solo i 4 sheet schema (parametri/domande/motivazioni).

I 3 sheet "vecchi" (Database_model, Examples, Answers) hanno header e ordine
colonne IDENTICI al vecchio progetto Django (vedi test_excel_export.py).
Questo garantisce che i file siano scambiabili: download + re-upload = round-trip.
"""
from __future__ import annotations
from typing import Iterable, List, Optional
from datetime import datetime

from openpyxl import Workbook
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table, TableStyleInfo
from sqlalchemy.orm import Session

import models
from services.citation import apply_excel_citation


# ============================================================================
# Header costanti (identici al vecchio progetto per i 3 sheet di compatibilità)
# ============================================================================

DATABASE_MODEL_HEADERS = [
    "Language",
    "Parameter_Label",
    "Question_ID",
    "Question",
    "Question_Examples_YES",
    "Question_Intructions_Comments",
    "Language_Answer",
    "Language_Comments",
    "Language_Examples",
    "Language_Example_Gloss",
    "Language_Example_Translation",
    "Language_References",
]

EXAMPLES_HEADERS = [
    "Language ID",
    "Question ID",
    "Example #",
    "Example text",
    "Transliteration",
    "Gloss",
    "English translation",
    "Reference",
]

ANSWERS_HEADERS = [
    "Language ID",
    "Parameter Label",
    "Question ID",
    "Question",
    "Question status",
    "Answer",
    "Parameter value",
    "Motivation",
    "Comments",
]

# Schema sheets (nuovi, non presenti nel vecchio progetto)
MOTIVATIONS_HEADERS = ["ID", "Code", "Label"]

PARAMETERS_HEADERS = [
    "ID", "Position", "Name", "Schema", "Type", "Level",
    "Short Description", "Long Description",
    "Implicational Condition", "Explanation of Implicational Condition",
    "Is Active",
]

QUESTIONS_HEADERS = [
    "ID", "Parameter ID", "Text", "Template Type",
    "Instruction", "Instruction YES", "Instruction NO",
    "Example YES", "Help Info",
    "Is Stop Question", "Is Active",
]

QUESTION_ALLOWED_MOTIVATIONS_HEADERS = ["Question ID", "Motivation Code"]

# Admin-only sheet: nota libera per (lingua, parametro)
ADMIN_NOTES_HEADERS = ["Parameter ID", "Parameter Name", "Admin Note"]

# Header per la lista lingue
LANGUAGE_LIST_HEADERS = [
    "Name",
    "ID",
    "Top-level family",
    "Family",
    "Group",
    "ISO code",
    "Glottocode",
    "Location",
    "Latitude",
    "Longitude",
    "Supervisor",
    "Informant",
    "Historical",
    "Source",
    "Status",
    "Assigned user",
    "Email",
    "Date last change",
]


_BOLD_WHITE = Font(bold=True, color="FFFFFF")


def _split_lines_to_str(value: Optional[str]) -> str:
    """Normalizza newlines per concatenare in cella multilinea."""
    if not value:
        return ""
    return str(value).replace("\r\n", "\n").replace("\r", "\n")


def _style_table(ws, name: str, n_cols: int, widths: List[int]):
    """Applica TableStyle e larghezze colonne."""
    if ws.max_row < 2:
        # comunque applico le larghezze
        for idx, w in enumerate(widths, start=1):
            if idx > n_cols:
                break
            ws.column_dimensions[get_column_letter(idx)].width = w
        return
    ref = f"A1:{get_column_letter(n_cols)}{ws.max_row}"
    tbl = Table(displayName=name, ref=ref)
    tbl.tableStyleInfo = TableStyleInfo(
        name="TableStyleMedium2",
        showFirstColumn=False, showLastColumn=False,
        showRowStripes=True, showColumnStripes=False,
    )
    ws.add_table(tbl)
    ws.freeze_panes = "A2"
    for idx, w in enumerate(widths, start=1):
        if idx > n_cols:
            break
        ws.column_dimensions[get_column_letter(idx)].width = w


def _bold_header_row(ws, n_cols: int):
    for i in range(1, n_cols + 1):
        ws.cell(row=1, column=i).font = _BOLD_WHITE


def _pretty_qc_from_status(status: Optional[str]) -> str:
    """Mappa lo status di un Answer alla label leggibile (replicato dal vecchio progetto)."""
    s = (status or "").lower()
    if s == "approved":
        return "Done"
    if s in ("waiting_for_approval", "waiting"):
        return "Needs review"
    return "Not compiled"


# ============================================================================
# 1. LANGUAGE WORKBOOK (7 sheet per admin, 1 per user)
# ============================================================================

def build_language_workbook(
    db: Session,
    lang: models.Language,
    is_admin: bool = True,
) -> Workbook:
    """
    Genera il workbook di una singola lingua.

    Admin: 7 sheet [Database_model, Answers, Examples, Motivations, Parameters,
                    Questions, QuestionAllowedMotivations]
    User:  1 sheet [Examples]
    """
    # Pre-load: parametri attivi ordinati
    params = (
        db.query(models.ParameterDef)
        .filter(models.ParameterDef.is_active == True)
        .order_by(models.ParameterDef.position, models.ParameterDef.id)
        .all()
    )

    # Domande per parametro (ordinate per id). Solo attive: gli sheet di
    # esempi/risposte non devono mostrare question disattivate.
    # (Lo sheet "Questions" di metadati più sotto fa una query a parte e
    # continua a includere anche le inactive, perché documenta lo schema.)
    questions_by_param: dict[str, list[models.Question]] = {}
    all_questions = (
        db.query(models.Question)
        .filter(models.Question.is_active == True)
        .order_by(models.Question.parameter_id, models.Question.id)
        .all()
    )
    for q in all_questions:
        questions_by_param.setdefault(q.parameter_id, []).append(q)

    # Risposte per la lingua, indicizzate per question_id
    answers = (
        db.query(models.Answer)
        .filter(models.Answer.language_id == lang.id)
        .all()
    )
    answers_by_qid = {a.question_id: a for a in answers}

    # Esempi raggruppati per question_id (passando per la answer)
    examples_by_qid: dict[str, list[models.Example]] = {}
    for a in answers:
        if a.examples:
            examples_by_qid[a.question_id] = sorted(
                list(a.examples),
                key=lambda e: _example_sort_key(e),
            )

    # AnswerMotivation -> mappa motivation_id per veloce lookup
    mot_by_id = {m.id: m for m in db.query(models.Motivation).all()}

    wb = Workbook()

    # === Sheet Examples (sempre presente) ===
    ws_examples = wb.active
    ws_examples.title = "Examples"
    ws_examples.append(EXAMPLES_HEADERS)
    _bold_header_row(ws_examples, len(EXAMPLES_HEADERS))

    for p in params:
        for q in questions_by_param.get(p.id, []):
            for ex in examples_by_qid.get(q.id, []):
                ws_examples.append([
                    lang.id,
                    q.id,
                    ex.number or "",
                    ex.textarea or "",
                    ex.transliteration or "",
                    ex.gloss or "",
                    ex.translation or "",
                    ex.reference or "",
                ])

    _style_table(ws_examples, "Examples", len(EXAMPLES_HEADERS), [14, 14, 10, 36, 22, 22, 26, 24])

    if not is_admin:
        apply_excel_citation(wb)
        return wb

    # === Sheet Database_model (admin, primo sheet visivo) ===
    ws_db = wb.create_sheet("Database_model", 0)
    ws_db.append(DATABASE_MODEL_HEADERS)
    _bold_header_row(ws_db, len(DATABASE_MODEL_HEADERS))

    for p in params:
        for q in questions_by_param.get(p.id, []):
            a = answers_by_qid.get(q.id)
            lang_answer = ""
            lang_comments = ""
            if a:
                if a.response_text == "yes":
                    lang_answer = "YES"
                elif a.response_text == "no":
                    lang_answer = "NO"
                lang_comments = a.comments or ""

            ex_list = examples_by_qid.get(q.id, [])
            cell_examples = "\n".join((ex.textarea or "") for ex in ex_list) if ex_list else ""
            cell_gloss = "\n".join((ex.gloss or "") for ex in ex_list) if ex_list else ""
            cell_transl = "\n".join((ex.translation or "") for ex in ex_list) if ex_list else ""
            cell_refs = "\n".join((ex.reference or "") for ex in ex_list) if ex_list else ""

            ws_db.append([
                lang.name_full,
                p.id,
                q.id,
                q.text or "",
                q.example_yes or "",
                q.instruction or "",
                lang_answer,
                lang_comments,
                cell_examples,
                cell_gloss,
                cell_transl,
                cell_refs,
            ])

    _style_table(
        ws_db, "DatabaseModel", len(DATABASE_MODEL_HEADERS),
        [18, 14, 18, 36, 24, 24, 12, 26, 30, 22, 22, 22],
    )

    # === Sheet Answers (admin) ===
    ws_ans = wb.create_sheet("Answers", 1)
    ws_ans.append(ANSWERS_HEADERS)
    _bold_header_row(ws_ans, len(ANSWERS_HEADERS))

    # Carico anche eval per il "Parameter value"
    lp_qs = (
        db.query(models.LanguageParameter)
        .filter(models.LanguageParameter.language_id == lang.id)
        .all()
    )
    value_orig_by_pid = {lp.parameter_id: (lp.value_orig or "") for lp in lp_qs}
    value_eval_by_pid: dict[str, str] = {}
    for lp in lp_qs:
        if lp.eval and lp.eval.value_eval:
            value_eval_by_pid[lp.parameter_id] = lp.eval.value_eval
        else:
            value_eval_by_pid[lp.parameter_id] = ""

    for p in params:
        for q in questions_by_param.get(p.id, []):
            a = answers_by_qid.get(q.id)
            param_value = value_eval_by_pid.get(q.parameter_id) or value_orig_by_pid.get(q.parameter_id) or ""
            if a:
                mot_codes = []
                for am in a.answer_motivations:
                    m = mot_by_id.get(am.motivation_id)
                    if m:
                        mot_codes.append(m.label or m.code)
                ws_ans.append([
                    lang.id,
                    p.id,
                    q.id,
                    q.text or "",
                    _pretty_qc_from_status(a.status),
                    a.response_text or "",
                    param_value,
                    "; ".join(mot_codes),
                    a.comments or "",
                ])
            else:
                ws_ans.append([
                    lang.id,
                    p.id,
                    q.id,
                    q.text or "",
                    "Not compiled",
                    "",
                    param_value,
                    "",
                    "",
                ])

    _style_table(ws_ans, "Answers", len(ANSWERS_HEADERS), [14, 18, 14, 36, 18, 10, 16, 28, 26])

    # === Sheet Admin Notes (admin) ===
    # Nota libera (testo) per ogni (lingua, parametro). Vivono su
    # LanguageParameterStatus.admin_note. Lo sheet contiene solo i parametri
    # con una nota non vuota, ordinati come gli altri sheet.
    ws_notes = wb.create_sheet("Admin Notes")
    ws_notes.append(ADMIN_NOTES_HEADERS)
    _bold_header_row(ws_notes, len(ADMIN_NOTES_HEADERS))

    notes_by_pid = {
        s.parameter_id: (s.admin_note or "")
        for s in db.query(models.LanguageParameterStatus)
        .filter(models.LanguageParameterStatus.language_id == lang.id)
        .all()
        if s.admin_note
    }
    for p in params:
        note = notes_by_pid.get(p.id, "")
        if note:
            ws_notes.append([p.id, p.name or "", note])

    _style_table(ws_notes, "AdminNotes", len(ADMIN_NOTES_HEADERS), [14, 36, 60])

    # === Sheet schema (Motivations, Parameters, Questions, QuestionAllowedMotivations) ===
    _append_schema_sheets(db, wb)

    apply_excel_citation(wb)
    return wb


def _example_sort_key(ex: models.Example):
    """Ordina gli esempi per number numerico (se possibile), poi per id."""
    try:
        return (0, int(ex.number or "0"), ex.id or 0)
    except (ValueError, TypeError):
        return (1, str(ex.number or ""), ex.id or 0)


# ============================================================================
# 2. LANGUAGE LIST WORKBOOK (metadati delle lingue selezionate)
# ============================================================================

def _xlsx_sanitize(v):
    """Converte valori non-Excel-friendly in stringhe."""
    if v is None:
        return ""
    if isinstance(v, bool):
        return "Yes" if v else "No"
    if isinstance(v, datetime):
        return v.replace(tzinfo=None) if v.tzinfo else v
    return v


def build_language_list_workbook(
    db: Session,
    languages: Iterable[models.Language],
) -> Workbook:
    """
    Workbook con un solo sheet 'Languages' contenente i metadati delle lingue.
    """
    wb = Workbook()
    ws = wb.active
    ws.title = "Languages"
    ws.append(LANGUAGE_LIST_HEADERS)
    _bold_header_row(ws, len(LANGUAGE_LIST_HEADERS))

    for L in languages:
        assigned_name = ""
        assigned_email = ""
        if L.assigned_user_id:
            user = db.query(models.User).filter(models.User.id == L.assigned_user_id).first()
            if user:
                full = f"{user.name or ''} {user.surname or ''}".strip()
                assigned_name = full or (user.email or "")
                assigned_email = user.email or ""

        ws.append([
            _xlsx_sanitize(L.name_full),
            _xlsx_sanitize(L.id),
            _xlsx_sanitize(L.top_level_family),
            _xlsx_sanitize(L.family),
            _xlsx_sanitize(L.grp),
            _xlsx_sanitize(L.isocode),
            _xlsx_sanitize(L.glottocode),
            _xlsx_sanitize(L.location),
            _xlsx_sanitize(float(L.latitude) if L.latitude is not None else None),
            _xlsx_sanitize(float(L.longitude) if L.longitude is not None else None),
            _xlsx_sanitize(L.supervisor),
            _xlsx_sanitize(L.informant),
            _xlsx_sanitize(L.historical_language),
            _xlsx_sanitize(L.source),
            _xlsx_sanitize(L.status or "pending"),
            _xlsx_sanitize(assigned_name),
            _xlsx_sanitize(assigned_email),
            L.updated_at if L.updated_at is not None else None,
        ])

    # Stile tabella: header bianco su fondo blu (TableStyleMedium2) +
    # freeze pane + larghezze. Senza il fill colorato del table style
    # l'header (font bianco) sarebbe invisibile su fondo bianco.
    n_cols = len(LANGUAGE_LIST_HEADERS)
    widths = [22, 10, 16, 16, 14, 10, 12, 18, 10, 10, 16, 16, 10, 28, 12, 22, 26, 18]
    _style_table(ws, "Languages", n_cols, widths)

    # Formatta la colonna Date last change (ultima) come datetime locale
    last_col = get_column_letter(n_cols)
    for cell in ws[last_col][1:]:
        cell.number_format = "yyyy-mm-dd hh:mm"

    apply_excel_citation(wb)
    return wb


# ============================================================================
# 3. SCHEMA WORKBOOK (4 sheet: motivations, parameters, questions, qam)
# ============================================================================

def _append_schema_sheets(db: Session, wb: Workbook) -> None:
    """Aggiunge i 4 sheet schema al workbook esistente (in coda)."""
    # Motivations
    ws_mot = wb.create_sheet("Motivations")
    ws_mot.append(MOTIVATIONS_HEADERS)
    _bold_header_row(ws_mot, len(MOTIVATIONS_HEADERS))
    for m in db.query(models.Motivation).order_by(models.Motivation.code).all():
        ws_mot.append([
            m.id,
            m.code or "",
            m.label or "",
        ])
    _style_table(ws_mot, "Motivations", len(MOTIVATIONS_HEADERS), [8, 14, 50])

    # Parameters
    ws_par = wb.create_sheet("Parameters")
    ws_par.append(PARAMETERS_HEADERS)
    _bold_header_row(ws_par, len(PARAMETERS_HEADERS))
    for p in db.query(models.ParameterDef).order_by(models.ParameterDef.position, models.ParameterDef.id).all():
        ws_par.append([
            p.id,
            p.position,
            p.name or "",
            p.schema or "",
            p.param_type or "",
            p.level_of_comparison or "",
            p.short_description or "",
            p.long_description or "",
            p.implicational_condition or "",
            p.description_of_the_implicational_condition or "",
            "Yes" if p.is_active else "No",
        ])
    _style_table(ws_par, "Parameters", len(PARAMETERS_HEADERS), [10, 8, 30, 16, 16, 18, 30, 30, 22, 30, 10])

    # Questions
    ws_q = wb.create_sheet("Questions")
    ws_q.append(QUESTIONS_HEADERS)
    _bold_header_row(ws_q, len(QUESTIONS_HEADERS))
    for q in db.query(models.Question).order_by(models.Question.parameter_id, models.Question.id).all():
        ws_q.append([
            q.id,
            q.parameter_id,
            q.text or "",
            q.template_type or "",
            q.instruction or "",
            q.instruction_yes or "",
            q.instruction_no or "",
            q.example_yes or "",
            q.help_info or "",
            "Yes" if q.is_stop_question else "No",
            "Yes" if q.is_active else "No",
        ])
    _style_table(ws_q, "Questions", len(QUESTIONS_HEADERS), [16, 14, 36, 14, 24, 24, 24, 24, 24, 12, 10])

    # QuestionAllowedMotivations
    ws_qam = wb.create_sheet("QuestionAllowedMotivations")
    ws_qam.append(QUESTION_ALLOWED_MOTIVATIONS_HEADERS)
    _bold_header_row(ws_qam, len(QUESTION_ALLOWED_MOTIVATIONS_HEADERS))
    for qam in (
        db.query(models.QuestionAllowedMotivation)
        .order_by(models.QuestionAllowedMotivation.question_id)
        .all()
    ):
        m = db.query(models.Motivation).filter(models.Motivation.id == qam.motivation_id).first()
        ws_qam.append([
            qam.question_id,
            m.code if m else "",
        ])
    _style_table(ws_qam, "QuestionAllowedMotivations", len(QUESTION_ALLOWED_MOTIVATIONS_HEADERS), [16, 14])


def build_schema_workbook(db: Session) -> Workbook:
    """
    Workbook con SOLO i 4 sheet schema (parametri/domande/motivazioni).
    Esportabile dalla pagina Parameters per editing offline.
    """
    wb = Workbook()
    # Rimuovo lo sheet di default
    default = wb.active
    wb.remove(default)
    _append_schema_sheets(db, wb)
    apply_excel_citation(wb)
    return wb
