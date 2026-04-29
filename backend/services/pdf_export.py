"""PDF export utilities for the admin parameter detail report."""
from __future__ import annotations

import os
from datetime import datetime
from typing import Any, Iterable

from fpdf import FPDF


def _font_dir() -> str:
    """Locate the DejaVu TTF directory bundled with matplotlib.

    DejaVu Sans is shipped inside the matplotlib package (`mpl-data/fonts/ttf`)
    and covers Latin extended, Greek, Cyrillic, Hebrew, and several other
    scripts. We reuse it instead of bundling our own copy.
    """
    import matplotlib
    return os.path.join(os.path.dirname(matplotlib.__file__), "mpl-data", "fonts", "ttf")


FONT_FAMILY = "DejaVu"


class _ParamReport(FPDF):
    def header(self) -> None:
        self.set_font(FONT_FAMILY, style="B", size=9)
        self.set_text_color(97, 101, 107)
        self.cell(0, 10, "Parameter Detail Report", ln=True, align="R")
        self.set_draw_color(218, 221, 226)
        self.line(10, 18, 200, 18)
        self.ln(5)

    def footer(self) -> None:
        self.set_y(-15)
        self.set_font(FONT_FAMILY, style="I", size=8)
        self.set_text_color(97, 101, 107)
        self.set_draw_color(218, 221, 226)
        self.line(10, self.get_y(), 200, self.get_y())
        self.cell(0, 10, f"Page {self.page_no()}", align="C")


class _ParamListReport(FPDF):
    """Report con info generali di una collezione di parametri."""
    def header(self) -> None:
        self.set_font(FONT_FAMILY, style="B", size=9)
        self.set_text_color(97, 101, 107)
        self.cell(0, 10, "Parameters Info Report", ln=True, align="R")
        self.set_draw_color(218, 221, 226)
        self.line(10, 18, 200, 18)
        self.ln(5)

    def footer(self) -> None:
        self.set_y(-15)
        self.set_font(FONT_FAMILY, style="I", size=8)
        self.set_text_color(97, 101, 107)
        self.set_draw_color(218, 221, 226)
        self.line(10, self.get_y(), 200, self.get_y())
        self.cell(0, 10, f"Page {self.page_no()}", align="C")


def _register_fonts(pdf: FPDF) -> None:
    d = _font_dir()
    pdf.add_font(FONT_FAMILY, "", os.path.join(d, "DejaVuSans.ttf"))
    pdf.add_font(FONT_FAMILY, "B", os.path.join(d, "DejaVuSans-Bold.ttf"))
    pdf.add_font(FONT_FAMILY, "I", os.path.join(d, "DejaVuSans-Oblique.ttf"))
    pdf.add_font(FONT_FAMILY, "BI", os.path.join(d, "DejaVuSans-BoldOblique.ttf"))


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
    pdf.set_auto_page_break(auto=True, margin=15)

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
    questions = list(questions)
    if not questions:
        pdf.set_font(FONT_FAMILY, style="I", size=10)
        pdf.set_text_color(97, 101, 107)
        pdf.cell(0, 8, "No questions linked to this parameter.", ln=True)
    else:
        for q in questions:
            q_type = "Stop Question" if q.is_stop_question else ""

            pdf.set_font(FONT_FAMILY, style="B", size=11)
            pdf.set_text_color(27, 29, 32)
            pdf.set_fill_color(241, 242, 244)
            pdf.set_draw_color(218, 221, 226)
            pdf.cell(0, 8, f"  {q.id} {q_type}", ln=True, fill=True, border="B")
            pdf.ln(3)

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
                pdf.set_font(FONT_FAMILY, size=10)
                pdf.set_text_color(27, 29, 32)
                for link in links:
                    m = getattr(link, "motivation", None)
                    if m is None:
                        continue
                    pdf.set_x(15)
                    pdf.multi_cell(0, 5, f"- {m.code} ({m.label})")

            pdf.ln(4)

    return bytes(pdf.output())


def build_all_parameters_pdf(parameters: Iterable[Any]) -> bytes:
    """Render a single PDF with the *general info* of every parameter.

    Layout:
      1. Cover with title, generation timestamp, total count
      2. Compact summary table (ID, Name, Schema, Type, Level, Status)
      3. One section per parameter with: header band, basic info, descriptions,
         logic & conditions. No questions (kept short by design).

    Args:
        parameters: Iterable of ParameterDef instances (already ordered).

    Returns:
        PDF bytes ready to stream to the client.
    """
    parameters = list(parameters)

    pdf = _ParamListReport()
    _register_fonts(pdf)
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()

    page_width = pdf.w - pdf.l_margin - pdf.r_margin

    # ---------- COVER ----------
    pdf.set_font(FONT_FAMILY, style="B", size=20)
    pdf.set_text_color(27, 29, 32)
    pdf.cell(0, 12, "Parameters Overview", ln=True)
    pdf.set_font(FONT_FAMILY, size=11)
    pdf.set_text_color(97, 101, 107)
    pdf.cell(0, 7, f"Generated on {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}", ln=True)
    pdf.cell(0, 7, f"Total parameters: {len(parameters)}", ln=True)
    pdf.ln(4)

    # ---------- INDEX (summary table) ----------
    pdf.set_font(FONT_FAMILY, style="B", size=12)
    pdf.set_fill_color(241, 242, 244)
    pdf.set_text_color(209, 65, 36)
    pdf.cell(0, 10, "  Index", ln=True, fill=True)
    pdf.ln(2)

    # Colonne dell'indice: larghezze ottimizzate per A4 portrait (~190mm utili)
    cols = [
        ("ID", 18),
        ("Name", 60),
        ("Schema", 32),
        ("Type", 30),
        ("Level", 28),
        ("Status", 22),
    ]
    # Header riga tabella
    pdf.set_font(FONT_FAMILY, style="B", size=9)
    pdf.set_text_color(97, 101, 107)
    pdf.set_fill_color(248, 249, 250)
    pdf.set_draw_color(218, 221, 226)
    for label, w in cols:
        pdf.cell(w, 7, label, border=1, fill=True)
    pdf.ln(7)

    # Righe dati
    pdf.set_font(FONT_FAMILY, size=9)
    pdf.set_text_color(27, 29, 32)
    for p in parameters:
        # Calcolo numero di righe necessarie per la riga più lunga (Name)
        name_lines = pdf.multi_cell(
            cols[1][1], 5, str(p.name or "-"), border=0, align="L",
            split_only=True,
        )
        row_h = max(6, 5 * len(name_lines))

        # Salvataggio Y di partenza per allineare verticalmente le celle
        y_start = pdf.get_y()
        x_start = pdf.get_x()

        def cell_text(value: str, w: float) -> None:
            x = pdf.get_x()
            y = pdf.get_y()
            pdf.multi_cell(w, 5, str(value or "-"), border=1, align="L")
            # multi_cell sposta y; riposiziono accanto
            pdf.set_xy(x + w, y)

        cell_text(str(p.id), cols[0][1])
        cell_text(p.name, cols[1][1])
        cell_text(p.schema, cols[2][1])
        cell_text(p.param_type, cols[3][1])
        cell_text(p.level_of_comparison, cols[4][1])
        cell_text("Active" if p.is_active else "Disabled", cols[5][1])

        # Sposto a riga successiva (la cella più alta determina l'altezza)
        pdf.set_xy(x_start, y_start + row_h)

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
        pdf.set_font(FONT_FAMILY, style="B", size=15)
        pdf.set_text_color(209, 65, 36)
        id_w = pdf.get_string_width(str(p.id) + "  ")
        pdf.cell(id_w, 9, str(p.id), ln=False)
        pdf.set_font(FONT_FAMILY, style="B", size=12)
        pdf.set_text_color(27, 29, 32)
        # Calcolo larghezza disponibile per il nome (riservo spazio al badge)
        badge_label = "Active" if p.is_active else "Disabled"
        pdf.set_font(FONT_FAMILY, style="B", size=8)
        badge_w = pdf.get_string_width(badge_label) + 6
        pdf.set_font(FONT_FAMILY, style="B", size=12)
        name_w = page_width - id_w - badge_w - 2
        pdf.cell(name_w, 9, str(p.name or ""), ln=False)
        # Badge a destra
        status_badge(p.is_active)
        pdf.ln(11)

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

    return bytes(pdf.output())
