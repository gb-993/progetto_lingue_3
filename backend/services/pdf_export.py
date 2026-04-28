"""PDF export utilities for the admin parameter detail report."""
from __future__ import annotations

import os
from typing import Any

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
