"""PDF export utilities for the admin parameter detail report."""
from __future__ import annotations

import os
from datetime import datetime
from typing import Any, Iterable

from time_utils import utc_now

from fpdf import FPDF
from fpdf.fonts import FontFace

from services.citation import PDF_FOOTER_MARGIN_MM, render_pdf_citation_footer


def _font_dir() -> str:
    """Locate the DejaVu TTF directory bundled with matplotlib.

    DejaVu Sans is shipped inside the matplotlib package (`mpl-data/fonts/ttf`)
    and covers Latin extended, Greek, Cyrillic, Hebrew, and several other
    scripts. We reuse it instead of bundling our own copy.
    """
    import matplotlib
    return os.path.join(os.path.dirname(matplotlib.__file__), "mpl-data", "fonts", "ttf")


FONT_FAMILY = "DejaVu"


class _CitationFooterReport(FPDF):
    """Base class: footer con citazione PCM_Hub + numero pagina.

    Le sottoclassi devono solo definire ``header()`` e impostare
    ``HEADER_TITLE``. Il footer e' centralizzato in services/citation.
    """
    HEADER_TITLE: str = ""

    def header(self) -> None:
        self.set_font(FONT_FAMILY, style="B", size=9)
        self.set_text_color(97, 101, 107)
        self.cell(0, 10, self.HEADER_TITLE, ln=True, align="R")
        self.set_draw_color(218, 221, 226)
        self.line(10, 18, 200, 18)
        self.ln(5)

    def footer(self) -> None:
        render_pdf_citation_footer(self, FONT_FAMILY)


class _ParamReport(_CitationFooterReport):
    HEADER_TITLE = "Parameter Detail Report"


class _ParamListReport(_CitationFooterReport):
    """Report con info generali di una collezione di parametri."""
    HEADER_TITLE = "Parameters Info Report"


class _ParamChangelogReport(_CitationFooterReport):
    """Report cronologia modifiche di un singolo parametro."""
    HEADER_TITLE = "Parameter Change History"


class _LanguageReport(_CitationFooterReport):
    """Report parametric data di una singola lingua: cover + scheda per parametro."""
    HEADER_TITLE = "Language Parametric Data Report"


def _register_fonts(pdf: FPDF) -> None:
    d = _font_dir()
    pdf.add_font(FONT_FAMILY, "", os.path.join(d, "DejaVuSans.ttf"))
    pdf.add_font(FONT_FAMILY, "B", os.path.join(d, "DejaVuSans-Bold.ttf"))
    pdf.add_font(FONT_FAMILY, "I", os.path.join(d, "DejaVuSans-Oblique.ttf"))
    pdf.add_font(FONT_FAMILY, "BI", os.path.join(d, "DejaVuSans-BoldOblique.ttf"))


def _render_questions_section(pdf: FPDF, questions, *, base_size: int = 10) -> None:
    """Render della sezione 'Questions' di un parametro.

    Helper condivisa tra il PDF di singolo parametro (usato con base_size=10)
    e il bulk PDF di tutti i parametri (base_size=9, un punto più piccolo
    per ridurre verticalità senza compromettere leggibilità).

    Per le 'Allowed Motivations' viene mostrato solo il testo della motivation
    (label, fallback su code se il label è vuoto): niente codice tipo "MOT004"
    e niente parentesi tonde.
    """
    questions = list(questions)
    line_h = 5 if base_size <= 9 else 6
    block_gap = 2 if base_size <= 9 else 4

    def line(label: str, value: str = "") -> None:
        pdf.set_font(FONT_FAMILY, style="B", size=base_size)
        pdf.set_text_color(97, 101, 107)
        pdf.write(line_h, str(label) + " ")
        if value:
            pdf.set_font(FONT_FAMILY, size=base_size)
            pdf.set_text_color(27, 29, 32)
            pdf.write(line_h, str(value))
        pdf.ln(line_h + 1)

    def long_text(label: str, value: Any) -> None:
        line(label)
        pdf.set_font(FONT_FAMILY, size=base_size)
        pdf.set_text_color(27, 29, 32)
        pdf.multi_cell(0, 5, str(value or "-"))
        pdf.ln(block_gap)

    if not questions:
        pdf.set_font(FONT_FAMILY, style="I", size=base_size)
        pdf.set_text_color(97, 101, 107)
        pdf.cell(0, 8, "No questions linked to this parameter.", ln=True)
        return

    for q in questions:
        q_type = "Stop Question" if q.is_stop_question else ""
        pdf.set_font(FONT_FAMILY, style="B", size=base_size + 1)
        pdf.set_text_color(27, 29, 32)
        pdf.set_fill_color(241, 242, 244)
        pdf.set_draw_color(218, 221, 226)
        pdf.cell(0, 8, f"  {q.id} {q_type}", ln=True, fill=True, border="B")
        pdf.ln(2)

        long_text("Text:", q.text)
        if q.instruction:
            long_text("Instructions:", q.instruction)
        if q.help_info:
            long_text("Help Info:", q.help_info)
        if q.example_yes:
            long_text("Example (YES):", q.example_yes)
        if q.instruction_yes:
            long_text("Instruction (YES):", q.instruction_yes)
        if q.instruction_no:
            long_text("Instruction (NO):", q.instruction_no)

        links = list(getattr(q, "allowed_motivations", []) or [])
        if links:
            line("Allowed Motivations (NO):")
            pdf.set_font(FONT_FAMILY, size=base_size)
            pdf.set_text_color(27, 29, 32)
            for link in links:
                m = getattr(link, "motivation", None)
                if m is None:
                    continue
                # Solo testo motivation (label) — niente codice né parentesi.
                # Fallback su code se label è assente, così non rendiamo "- ".
                text = m.label or m.code or ""
                if not text:
                    continue
                pdf.set_x(15)
                pdf.multi_cell(0, 5, f"- {text}")

        pdf.ln(block_gap)


def build_parameter_pdf(parameter, questions) -> bytes:
    """Render a parameter detail PDF.

    Args:
        parameter: ParameterDef instance.
        questions: Iterable of Question instances ordered for display, with
            ``allowed_motivations`` accessible.

    Returns:
        PDF bytes ready to stream to the client.
    """
    pdf = _ParamReport()
    _register_fonts(pdf)
    pdf.add_page()
    pdf.set_auto_page_break(auto=True, margin=PDF_FOOTER_MARGIN_MM)

    def section_title(title: str) -> None:
        pdf.ln(5)
        pdf.set_font(FONT_FAMILY, style="B", size=12)
        pdf.set_fill_color(241, 242, 244)
        pdf.set_text_color(209, 65, 36)
        pdf.cell(0, 10, f"  {title}", ln=True, fill=True)
        pdf.ln(3)

    def line(label: str, value: str = "") -> None:
        pdf.set_font(FONT_FAMILY, style="B", size=10)
        pdf.set_text_color(97, 101, 107)
        pdf.write(6, str(label) + " ")
        if value:
            pdf.set_font(FONT_FAMILY, size=10)
            pdf.set_text_color(27, 29, 32)
            pdf.write(6, str(value))
        pdf.ln(7)

    def long_text(label: str, value: Any) -> None:
        line(label)
        pdf.set_font(FONT_FAMILY, size=10)
        pdf.set_text_color(27, 29, 32)
        pdf.multi_cell(0, 5, str(value or "-"))
        pdf.ln(4)

    # Title
    pdf.set_font(FONT_FAMILY, style="B", size=18)
    pdf.set_text_color(27, 29, 32)
    pdf.cell(pdf.get_string_width("Parameter: "), 10, "Parameter: ", ln=False)
    pdf.set_text_color(209, 65, 36)
    pdf.cell(0, 10, str(parameter.id), ln=True)

    # Subtitle
    pdf.set_font(FONT_FAMILY, size=14)
    pdf.set_text_color(97, 101, 107)
    pdf.cell(0, 8, str(parameter.name), ln=True)
    pdf.ln(2)

    # 1. Basic info
    section_title("Basic Information")
    line("Status:", "Active" if parameter.is_active else "Disabled")
    line("Schema:", parameter.schema or "-")
    line("Type:", parameter.param_type or "-")
    line("Level of comparison:", parameter.level_of_comparison or "-")

    # 2. Descriptions
    section_title("Descriptions")
    long_text("Short Description:", parameter.short_description)
    long_text("Long Description:", parameter.long_description)

    # 3. Logic
    section_title("Logic & Conditions")
    line("Implicational Condition(s):", parameter.implicational_condition or "-")
    long_text(
        "Explication of the Implicational Condition(s):",
        parameter.description_of_the_implicational_condition,
    )

    # 4. Questions
    section_title("Questions")
    _render_questions_section(pdf, questions, base_size=10)

    return bytes(pdf.output())


def build_all_parameters_pdf(parameters: Iterable[Any], questions_by_param_id: dict | None = None) -> bytes:
    """Render a single PDF with the *general info* of every parameter.

    Layout:
      1. Cover with title, generation timestamp, total count
      2. Compact summary table (ID, Name, Schema, Type, Level, Status)
      3. One section per parameter with: header band, basic info, descriptions,
         logic & conditions, questions (Text/Instructions/Examples/Allowed
         Motivations) — stessa struttura del PDF singolo.

    Args:
        parameters: Iterable of ParameterDef instances (already ordered).
        questions_by_param_id: dict {parameter_id: [Question, ...]} con
            ``allowed_motivations.motivation`` pre-caricati. Se None, la sezione
            Questions viene omessa (compatibile con vecchi callers).

    Returns:
        PDF bytes ready to stream to the client.
    """
    parameters = list(parameters)
    questions_by_param_id = questions_by_param_id or {}

    pdf = _ParamListReport()
    _register_fonts(pdf)
    pdf.set_auto_page_break(auto=True, margin=PDF_FOOTER_MARGIN_MM)
    pdf.add_page()

    page_width = pdf.w - pdf.l_margin - pdf.r_margin

    # ---------- COVER ----------
    pdf.set_font(FONT_FAMILY, style="B", size=20)
    pdf.set_text_color(27, 29, 32)
    pdf.cell(0, 12, "Parameters Overview", ln=True)
    pdf.set_font(FONT_FAMILY, size=11)
    pdf.set_text_color(97, 101, 107)
    pdf.cell(0, 7, f"Generated on {utc_now().strftime('%Y-%m-%d %H:%M UTC')}", ln=True)
    pdf.cell(0, 7, f"Total parameters: {len(parameters)}", ln=True)
    pdf.ln(4)

    # ---------- INDEX (summary table) ----------
    pdf.set_font(FONT_FAMILY, style="B", size=12)
    pdf.set_fill_color(241, 242, 244)
    pdf.set_text_color(209, 65, 36)
    pdf.cell(0, 10, "  Index", ln=True, fill=True)
    pdf.ln(2)

    # Colonne dell'indice: larghezze ottimizzate per A4 portrait (~190mm utili)
    col_widths = (18, 60, 32, 30, 28, 22)
    headers = ("ID", "Name", "Schema", "Type", "Level", "Status")

    pdf.set_font(FONT_FAMILY, size=9)
    pdf.set_text_color(27, 29, 32)
    pdf.set_draw_color(218, 221, 226)

    # API nativa fpdf2: gestisce word-wrap, page break per riga intera,
    # ripetizione automatica dell'header su ogni pagina.
    with pdf.table(
        col_widths=col_widths,
        headings_style=FontFace(emphasis="B", color=(97, 101, 107), fill_color=(248, 249, 250)),
        line_height=5,
        text_align="LEFT",
        first_row_as_headings=True,
    ) as table:
        head = table.row()
        for h in headers:
            head.cell(h)
        for p in parameters:
            row = table.row()
            row.cell(str(p.id))
            row.cell(str(p.name or "-"))
            row.cell(str(p.schema or "-"))
            row.cell(str(p.param_type or "-"))
            row.cell(str(p.level_of_comparison or "-"))
            row.cell("Active" if p.is_active else "Disabled")

    pdf.ln(6)

    # ---------- DETTAGLIO PARAMETRI ----------
    pdf.set_font(FONT_FAMILY, style="B", size=12)
    pdf.set_fill_color(241, 242, 244)
    pdf.set_text_color(209, 65, 36)
    pdf.cell(0, 10, "  Details", ln=True, fill=True)
    pdf.ln(2)

    def section_title(title: str) -> None:
        pdf.set_font(FONT_FAMILY, style="B", size=10)
        pdf.set_fill_color(241, 242, 244)
        pdf.set_text_color(209, 65, 36)
        pdf.cell(0, 7, f"  {title}", ln=True, fill=True)
        pdf.ln(1)

    def line(label: str, value: str = "") -> None:
        pdf.set_font(FONT_FAMILY, style="B", size=9)
        pdf.set_text_color(97, 101, 107)
        pdf.write(5, str(label) + " ")
        if value:
            pdf.set_font(FONT_FAMILY, size=9)
            pdf.set_text_color(27, 29, 32)
            pdf.write(5, str(value))
        pdf.ln(6)

    def long_text(label: str, value: Any) -> None:
        line(label)
        pdf.set_font(FONT_FAMILY, size=9)
        pdf.set_text_color(27, 29, 32)
        pdf.multi_cell(0, 5, str(value or "-"))
        pdf.ln(2)

    def status_badge(active: bool) -> None:
        # Pillola colorata accanto al titolo, sulla stessa riga
        label = "Active" if active else "Disabled"
        if active:
            pdf.set_fill_color(220, 252, 231)
            pdf.set_text_color(22, 101, 52)
        else:
            pdf.set_fill_color(254, 226, 226)
            pdf.set_text_color(153, 27, 27)
        pdf.set_font(FONT_FAMILY, style="B", size=8)
        w = pdf.get_string_width(label) + 6
        pdf.cell(w, 5, label, ln=False, fill=True, border=0, align="C")
        pdf.set_text_color(27, 29, 32)

    if not parameters:
        pdf.set_font(FONT_FAMILY, style="I", size=10)
        pdf.set_text_color(97, 101, 107)
        pdf.cell(0, 8, "No parameters to export.", ln=True)
        return bytes(pdf.output())

    for idx, p in enumerate(parameters):
        # Separatore prima di ogni parametro tranne il primo
        if idx > 0:
            pdf.ln(3)
            pdf.set_draw_color(209, 65, 36)
            pdf.set_line_width(0.5)
            y = pdf.get_y()
            pdf.line(pdf.l_margin, y, pdf.l_margin + page_width, y)
            pdf.set_line_width(0.2)
            pdf.set_draw_color(218, 221, 226)
            pdf.ln(4)

        # Riserva spazio: se sta per finire la pagina, vai a capo. ~50mm minimi.
        if pdf.get_y() > pdf.h - 50:
            pdf.add_page()

        # Header parametro: ID grosso colorato + Name grigio + badge status sulla riga
        header_y = pdf.get_y()
        pdf.set_font(FONT_FAMILY, style="B", size=15)
        pdf.set_text_color(209, 65, 36)
        id_w = pdf.get_string_width(str(p.id) + "  ")
        pdf.cell(id_w, 9, str(p.id), ln=False)

        # Badge status piazzato a destra prima, così il nome può andare a capo
        # nello spazio rimanente senza sforare l'A4.
        badge_label = "Active" if p.is_active else "Disabled"
        pdf.set_font(FONT_FAMILY, style="B", size=8)
        badge_w = pdf.get_string_width(badge_label) + 6
        name_w = page_width - id_w - badge_w - 2

        # Nome con word-wrap (multi_cell). new_x/new_y posizionano il cursore
        # subito dopo il nome senza scendere a capo, così il badge resta in linea.
        pdf.set_font(FONT_FAMILY, style="B", size=12)
        pdf.set_text_color(27, 29, 32)
        name_x = pdf.get_x()
        pdf.multi_cell(name_w, 7, str(p.name or ""), align="L",
                       new_x="RIGHT", new_y="TOP", max_line_height=7)

        # Allinea il badge al bordo destro sulla riga d'intestazione
        pdf.set_xy(pdf.l_margin + page_width - badge_w, header_y + 2)
        status_badge(p.is_active)
        # Vai sotto la sezione header (almeno una riga di nome)
        pdf.set_y(max(pdf.get_y(), header_y) + 9)

        # Basic info
        section_title("Basic Information")
        line("Schema:", p.schema or "-")
        line("Type:", p.param_type or "-")
        line("Level of comparison:", p.level_of_comparison or "-")
        pdf.ln(2)

        # Descriptions
        section_title("Descriptions")
        long_text("Short description:", p.short_description)
        long_text("Long description:", p.long_description)

        # Logic & conditions
        section_title("Logic & Conditions")
        line("Implicational condition(s):", p.implicational_condition or "-")
        long_text(
            "Explication of the implicational condition(s):",
            p.description_of_the_implicational_condition,
        )

        # Questions: stessa struttura del single-parameter PDF, font ridotto
        # di 1pt per coerenza col resto del bulk PDF.
        if questions_by_param_id:
            section_title("Questions")
            _render_questions_section(pdf, questions_by_param_id.get(p.id, []), base_size=9)

    return bytes(pdf.output())


def build_parameter_changelog_pdf(parameter, change_logs) -> bytes:
    """Render the change history PDF for a single parameter.

    Mirrors the UI filter in ParameterForm/QuestionForm: drops the "Test edit"
    placeholder entries and the auto-logged "DEACTIVATED..." rows. Newest
    entries first.
    """
    entries = [
        log for log in change_logs
        if not (log.change_note or "").startswith("Test edit")
        and not (log.change_note or "").startswith("DEACTIVATED")
    ]
    entries.sort(
        key=lambda l: l.created_at or datetime.min,
        reverse=True,
    )

    pdf = _ParamChangelogReport()
    _register_fonts(pdf)
    pdf.add_page()
    pdf.set_auto_page_break(auto=True, margin=PDF_FOOTER_MARGIN_MM)

    pdf.set_font(FONT_FAMILY, style="B", size=18)
    pdf.set_text_color(27, 29, 32)
    pdf.cell(pdf.get_string_width("Parameter: "), 10, "Parameter: ", ln=False)
    pdf.set_text_color(209, 65, 36)
    pdf.cell(0, 10, str(parameter.id), ln=True)

    pdf.set_font(FONT_FAMILY, size=14)
    pdf.set_text_color(97, 101, 107)
    pdf.cell(0, 8, str(parameter.name or ""), ln=True)
    pdf.ln(2)

    pdf.set_font(FONT_FAMILY, size=10)
    pdf.set_text_color(97, 101, 107)
    pdf.cell(0, 6, f"Generated on {utc_now().strftime('%Y-%m-%d %H:%M UTC')}", ln=True)
    pdf.cell(0, 6, f"Total entries: {len(entries)}", ln=True)
    pdf.ln(4)

    pdf.set_font(FONT_FAMILY, style="B", size=12)
    pdf.set_fill_color(241, 242, 244)
    pdf.set_text_color(209, 65, 36)
    pdf.cell(0, 10, "  Change history", ln=True, fill=True)
    pdf.ln(3)

    if not entries:
        pdf.set_font(FONT_FAMILY, style="I", size=10)
        pdf.set_text_color(97, 101, 107)
        pdf.cell(0, 8, "No changes recorded.", ln=True)
        return bytes(pdf.output())

    pdf.set_font(FONT_FAMILY, size=9)
    pdf.set_text_color(27, 29, 32)
    pdf.set_draw_color(218, 221, 226)

    with pdf.table(
        col_widths=(32, 50, 108),
        headings_style=FontFace(emphasis="B", color=(97, 101, 107), fill_color=(248, 249, 250)),
        line_height=5,
        text_align="LEFT",
        first_row_as_headings=True,
    ) as table:
        head = table.row()
        for h in ("Date", "Author", "Note"):
            head.cell(h)
        for log in entries:
            user = getattr(log, "user", None)
            if user is not None:
                full = " ".join(
                    s for s in (getattr(user, "name", None), getattr(user, "surname", None)) if s
                ).strip()
                author = full or getattr(user, "email", "") or "-"
            else:
                author = "-"
            row = table.row()
            row.cell(log.created_at.strftime("%Y-%m-%d %H:%M") if log.created_at else "-")
            row.cell(author)
            row.cell(log.change_note or "")

    return bytes(pdf.output())


# ============================================================================
# LANGUAGE PARAMETRIC DATA PDF
#
# Layout A (scelto in fase di design): una cover con metadati della lingua,
# poi una scheda per ogni parametro attivo (page break dopo ogni parametro).
# Ogni scheda elenca tutte le question attive del parametro, con risposta
# colorata, eventuali commenti, motivazioni ed esempi. I parametri senza
# nessuna risposta data appaiono comunque, con "Not answered" su ogni q.
# Le question/parametri disattivati sono esclusi.
#
# Footer identico al PDF parametri (citazione PCM_Hub + numero pagina) via
# `_LanguageReport`, sottoclasse di `_CitationFooterReport`.
# ============================================================================

_ANSWER_LABELS = {"yes": "YES", "no": "NO", "unsure": "UNSURE"}
_ANSWER_COLORS = {
    "yes": (21, 128, 61),     # green (allineato al frontend)
    "no": (185, 28, 28),      # red
    "unsure": (161, 98, 7),   # orange
}
_NOT_ANSWERED_COLOR = (130, 134, 140)  # grigio chiaro


def _example_sort_key_pdf(ex):
    """Stesso ordering di excel_export._example_sort_key (numerico se possibile)."""
    try:
        return (0, int(ex.number or "0"), ex.id or 0)
    except (ValueError, TypeError):
        return (1, str(ex.number or ""), ex.id or 0)


def build_language_pdf(db, lang) -> bytes:
    """Render del PDF parametric data per una singola lingua.

    Pre-carica tutti i dati necessari (parametri/question attivi, answer per
    lingua, esempi, motivazioni, valori parametri, admin notes) e poi rende
    una pagina per parametro.

    Args:
        db: SQLAlchemy Session.
        lang: models.Language instance.

    Returns:
        PDF bytes pronti per essere streamati al client.
    """
    # Import locale per evitare cicli (gli altri builder PDF non importano models).
    import models

    # ---------- pre-load ----------
    params = (
        db.query(models.ParameterDef)
        .filter(models.ParameterDef.is_active == True)
        .order_by(models.ParameterDef.position, models.ParameterDef.id)
        .all()
    )

    questions_by_param: dict[str, list[Any]] = {}
    for q in (
        db.query(models.Question)
        .filter(models.Question.is_active == True)
        .order_by(models.Question.parameter_id, models.Question.id)
        .all()
    ):
        questions_by_param.setdefault(q.parameter_id, []).append(q)

    answers = (
        db.query(models.Answer)
        .filter(models.Answer.language_id == lang.id)
        .all()
    )
    answers_by_qid = {a.question_id: a for a in answers}

    examples_by_qid: dict[str, list[Any]] = {}
    for a in answers:
        if a.examples:
            examples_by_qid[a.question_id] = sorted(
                list(a.examples), key=_example_sort_key_pdf,
            )

    mot_by_id = {m.id: m for m in db.query(models.Motivation).all()}

    notes_by_pid = {
        s.parameter_id: (s.admin_note or "")
        for s in db.query(models.LanguageParameterStatus)
        .filter(models.LanguageParameterStatus.language_id == lang.id)
        .all()
        if s.admin_note
    }

    lps = (
        db.query(models.LanguageParameter)
        .filter(models.LanguageParameter.language_id == lang.id)
        .all()
    )
    value_orig_by_pid = {lp.parameter_id: (lp.value_orig or "") for lp in lps}
    value_eval_by_pid: dict[str, str] = {}
    for lp in lps:
        if lp.eval and lp.eval.value_eval:
            value_eval_by_pid[lp.parameter_id] = lp.eval.value_eval

    # ---------- PDF setup ----------
    pdf = _LanguageReport()
    _register_fonts(pdf)
    pdf.set_auto_page_break(auto=True, margin=PDF_FOOTER_MARGIN_MM)
    pdf.add_page()

    # ---------- COVER ----------
    pdf.set_font(FONT_FAMILY, style="B", size=20)
    pdf.set_text_color(27, 29, 32)
    pdf.cell(pdf.get_string_width("Language: "), 12, "Language: ", ln=False)
    pdf.set_text_color(209, 65, 36)
    pdf.cell(0, 12, str(lang.name_full or lang.id), ln=True)

    pdf.set_font(FONT_FAMILY, size=12)
    pdf.set_text_color(97, 101, 107)
    pdf.cell(0, 7, f"ID: {lang.id}", ln=True)
    pdf.ln(4)

    pdf.set_font(FONT_FAMILY, style="B", size=12)
    pdf.set_fill_color(241, 242, 244)
    pdf.set_text_color(209, 65, 36)
    pdf.cell(0, 10, "  Language information", ln=True, fill=True)
    pdf.ln(2)

    def meta_row(label: str, value) -> None:
        # Stesso pattern di `line()` nel PDF parametri: pdf.write su una riga,
        # poi ln(). Evita gli errori "no horizontal space" che si verificano
        # accodando cell(w)+multi_cell(0) ripetutamente.
        if value in (None, ""):
            return
        pdf.set_x(pdf.l_margin)
        pdf.set_font(FONT_FAMILY, style="B", size=10)
        pdf.set_text_color(97, 101, 107)
        pdf.write(7, f"  {label} ")
        pdf.set_font(FONT_FAMILY, size=10)
        pdf.set_text_color(27, 29, 32)
        pdf.write(7, str(value))
        pdf.ln(8)

    meta_row("Top-level family:", lang.top_level_family)
    meta_row("Family:", lang.family)
    meta_row("Group:", lang.grp)
    meta_row("Glottocode:", lang.glottocode)
    meta_row("ISO code:", lang.isocode)
    meta_row("Location:", lang.location)
    coords = ""
    if lang.latitude is not None and lang.longitude is not None:
        coords = f"{float(lang.latitude):.4f}, {float(lang.longitude):.4f}"
    meta_row("Coordinates (lat, lng):", coords)
    meta_row("Historical:", "Yes" if lang.historical_language else "No")
    meta_row("Status:", (lang.status or "pending").replace("_", " ").title())
    meta_row("Supervisor:", lang.supervisor)
    meta_row("Informant:", lang.informant)
    meta_row("Source:", lang.source)

    pdf.ln(4)
    pdf.set_font(FONT_FAMILY, size=10)
    pdf.set_text_color(97, 101, 107)
    pdf.cell(0, 6, f"Generated on {utc_now().strftime('%Y-%m-%d %H:%M UTC')}", ln=True)
    pdf.cell(0, 6, f"Active parameters in this report: {len(params)}", ln=True)

    # ---------- ONE PAGE PER PARAMETER ----------
    for p in params:
        pdf.add_page()
        _render_parameter_card(
            pdf, p, questions_by_param.get(p.id, []),
            answers_by_qid, examples_by_qid, mot_by_id,
            notes_by_pid.get(p.id, ""),
            value_eval_by_pid.get(p.id) or value_orig_by_pid.get(p.id) or "",
        )

    return bytes(pdf.output())


def _render_parameter_card(
    pdf, p, questions, answers_by_qid, examples_by_qid, mot_by_id,
    admin_note: str, final_value: str,
) -> None:
    """Render della scheda di un singolo parametro: banner + value + admin
    note + tutte le question. Il chiamante e' responsabile del page break."""
    # Banner parametro
    pdf.set_font(FONT_FAMILY, style="B", size=14)
    pdf.set_fill_color(241, 242, 244)
    pdf.set_text_color(209, 65, 36)
    pdf.cell(0, 12, f"  Parameter {p.id} - {p.name or ''}", ln=True, fill=True)
    pdf.ln(2)

    # Valore consolidato (eval, fallback orig)
    pdf.set_font(FONT_FAMILY, style="B", size=11)
    pdf.set_text_color(97, 101, 107)
    pdf.cell(pdf.get_string_width("Value: "), 8, "Value: ", ln=False)
    if final_value:
        pdf.set_text_color(27, 29, 32)
        pdf.cell(0, 8, str(final_value), ln=True)
    else:
        pdf.set_text_color(*_NOT_ANSWERED_COLOR)
        pdf.cell(0, 8, "Not computed yet", ln=True)

    if admin_note:
        pdf.ln(1)
        pdf.set_font(FONT_FAMILY, style="B", size=10)
        pdf.set_text_color(97, 101, 107)
        pdf.cell(0, 6, "Admin note:", ln=True)
        pdf.set_font(FONT_FAMILY, size=10)
        pdf.set_text_color(27, 29, 32)
        pdf.multi_cell(0, 5, admin_note)

    pdf.ln(3)

    if not questions:
        pdf.set_font(FONT_FAMILY, style="I", size=10)
        pdf.set_text_color(97, 101, 107)
        pdf.cell(0, 6, "No active questions linked to this parameter.", ln=True)
        return

    for q in questions:
        _render_question_block(
            pdf, q, answers_by_qid.get(q.id),
            examples_by_qid.get(q.id, []), mot_by_id,
        )


def _render_question_block(pdf, q, answer, examples, mot_by_id) -> None:
    q_type = "  (Stop Question)" if q.is_stop_question else ""

    # Riga ID question con fondo grigio chiaro
    pdf.set_font(FONT_FAMILY, style="B", size=11)
    pdf.set_text_color(27, 29, 32)
    pdf.set_fill_color(248, 249, 250)
    pdf.cell(0, 8, f"  Q {q.id}{q_type}", ln=True, fill=True)
    pdf.ln(1)

    # Testo della question
    pdf.set_font(FONT_FAMILY, size=10)
    pdf.set_text_color(27, 29, 32)
    pdf.set_x(pdf.l_margin + 4)
    pdf.multi_cell(0, 5, q.text or "")
    pdf.ln(1)

    # Answer colorata
    pdf.set_x(pdf.l_margin + 4)
    pdf.set_font(FONT_FAMILY, style="B", size=10)
    pdf.set_text_color(97, 101, 107)
    pdf.cell(pdf.get_string_width("Answer: "), 6, "Answer: ", ln=False)

    pdf.set_font(FONT_FAMILY, style="B", size=10)
    rt = answer.response_text if answer else None
    if rt in _ANSWER_LABELS:
        pdf.set_text_color(*_ANSWER_COLORS[rt])
        pdf.cell(0, 6, _ANSWER_LABELS[rt], ln=True)
    else:
        pdf.set_text_color(*_NOT_ANSWERED_COLOR)
        pdf.cell(0, 6, "Not answered", ln=True)

    # Comments
    if answer and answer.comments:
        pdf.set_x(pdf.l_margin + 4)
        pdf.set_font(FONT_FAMILY, style="B", size=10)
        pdf.set_text_color(97, 101, 107)
        pdf.cell(pdf.get_string_width("Comments: "), 6, "Comments: ", ln=False)
        pdf.set_font(FONT_FAMILY, size=10)
        pdf.set_text_color(27, 29, 32)
        pdf.multi_cell(0, 5, answer.comments)

    # Motivations
    if answer:
        mot_labels = []
        for am in answer.answer_motivations:
            m = mot_by_id.get(am.motivation_id)
            if m:
                mot_labels.append(m.label or m.code or "")
        mot_labels = [lbl for lbl in mot_labels if lbl]
        if mot_labels:
            pdf.set_x(pdf.l_margin + 4)
            pdf.set_font(FONT_FAMILY, style="B", size=10)
            pdf.set_text_color(97, 101, 107)
            pdf.cell(pdf.get_string_width("Motivations: "), 6, "Motivations: ", ln=False)
            pdf.set_font(FONT_FAMILY, size=10)
            pdf.set_text_color(27, 29, 32)
            pdf.multi_cell(0, 5, "; ".join(mot_labels))

    # Examples (numerati, glossing su righe separate)
    if examples:
        pdf.set_x(pdf.l_margin + 4)
        pdf.set_font(FONT_FAMILY, style="B", size=10)
        pdf.set_text_color(97, 101, 107)
        pdf.cell(0, 6, "Examples:", ln=True)
        for i, ex in enumerate(examples, start=1):
            num = ex.number or str(i)
            pdf.set_x(pdf.l_margin + 8)
            pdf.set_font(FONT_FAMILY, size=10)
            pdf.set_text_color(27, 29, 32)
            pdf.multi_cell(0, 5, f"{num}. {ex.textarea or ''}")
            if ex.transliteration:
                pdf.set_x(pdf.l_margin + 12)
                pdf.set_font(FONT_FAMILY, style="I", size=9)
                pdf.set_text_color(97, 101, 107)
                pdf.multi_cell(0, 5, ex.transliteration)
            if ex.gloss:
                pdf.set_x(pdf.l_margin + 12)
                pdf.set_font(FONT_FAMILY, size=9)
                pdf.set_text_color(97, 101, 107)
                pdf.multi_cell(0, 5, ex.gloss)
            if ex.translation:
                pdf.set_x(pdf.l_margin + 12)
                pdf.set_font(FONT_FAMILY, size=10)
                pdf.set_text_color(27, 29, 32)
                pdf.multi_cell(0, 5, f"'{ex.translation}'")
            if ex.reference:
                pdf.set_x(pdf.l_margin + 12)
                pdf.set_font(FONT_FAMILY, style="I", size=9)
                pdf.set_text_color(97, 101, 107)
                pdf.multi_cell(0, 5, f"[{ex.reference}]")

    pdf.ln(3)
