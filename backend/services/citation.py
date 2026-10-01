"""Citazione da mettere in ogni file scaricabile."""
from __future__ import annotations

import html as _html
from datetime import datetime
from typing import Optional

from openpyxl import Workbook

from time_utils import utc_now


EDITORS = (
    "Guardiano, Cristina, Paola Crisma, Giuseppe Longobardi, "
    "Marco Longhin, Giovanni Battista Matteazzi, Emanuela Li Destri, "
    "Gaia Sorge"
)
YEAR = "2026"
WORK_TITLE = "The PCM_Hub"
VERSION = "version 1"

# proprietà del file Excel
DOC_TITLE = "PCM_Hub - Data Export"
DOC_CREATOR = "PCM_Hub"
DOC_SUBJECT = "Linguistic parameter data"
DOC_KEYWORDS = (
    "PCM_Hub, linguistics, parameters, comparative syntax, "
    "parametric comparison method"
)
DOC_CATEGORY = "Linguistic dataset"
DOC_LANGUAGE = "en"


def _format_date(dt: datetime) -> str:
    return dt.strftime("%d/%m/%Y")


def build_citation_text(when: Optional[datetime] = None) -> str:
    """Citazione su due righe, con la data di download."""
    when = when or utc_now()
    accessed = _format_date(when)
    return (
        "Downloaded from:\n"
        f"{EDITORS} (eds). {YEAR}. {WORK_TITLE} "
        f"({VERSION}, Accessed on {accessed})"
    )


def apply_excel_citation(wb: Workbook, when: Optional[datetime] = None) -> None:
    """Footer di stampa su ogni sheet + proprietà del file."""
    text = build_citation_text(when)
    footer_text = "&8" + text  # &8 = font 8 pt

    for ws in wb.worksheets:
        ws.oddFooter.center.text = footer_text
        ws.evenFooter.center.text = footer_text
        ws.firstFooter.center.text = footer_text
        # spazio per il footer su due righe
        ws.page_margins.bottom = 1.0
        ws.page_margins.footer = 0.3

    p = wb.properties
    p.title = DOC_TITLE
    p.creator = DOC_CREATOR
    p.lastModifiedBy = DOC_CREATOR
    p.description = text
    p.subject = DOC_SUBJECT
    p.keywords = DOC_KEYWORDS
    p.category = DOC_CATEGORY
    p.version = VERSION.split()[-1]
    p.language = DOC_LANGUAGE


# margine per set_auto_page_break
PDF_FOOTER_MARGIN_MM = 28


def render_pdf_citation_footer(pdf, font_family: str) -> None:
    """Linea, citazione e numero pagina; da chiamare in FPDF.footer()."""
    pdf.set_y(-22)
    pdf.set_draw_color(218, 221, 226)
    pdf.line(10, pdf.get_y(), 200, pdf.get_y())

    pdf.set_y(-20)
    pdf.set_font(font_family, style="I", size=7)
    pdf.set_text_color(120, 120, 120)
    pdf.multi_cell(0, 3, build_citation_text(), align="C")

    pdf.set_y(-9)
    pdf.set_font(font_family, style="I", size=8)
    pdf.set_text_color(97, 101, 107)
    pdf.cell(0, 5, f"Page {pdf.page_no()}", align="C")


def build_citation_comment(prefix: str = "# ", when: Optional[datetime] = None) -> str:
    """Citazione come righe di commento, per CSV/TXT."""
    text = build_citation_text(when)
    return "".join(f"{prefix}{line}\n" for line in text.split("\n"))


def render_html_citation_footer(when: Optional[datetime] = None) -> str:
    """Footer HTML con la citazione."""
    text = _html.escape(build_citation_text(when)).replace("\n", "<br>")
    return (
        '<footer style="font-family:Arial,Helvetica,sans-serif;font-size:11px;'
        'color:#787878;text-align:center;padding:12px 8px;border-top:1px solid '
        f'#dadde2;margin-top:8px">{text}</footer>'
    )


def inject_html_citation(html_str: str, when: Optional[datetime] = None) -> str:
    """Mette il footer prima di </body>, o in coda."""
    footer = render_html_citation_footer(when)
    if "</body>" in html_str:
        return html_str.replace("</body>", footer + "</body>", 1)
    return html_str + footer


def apply_matplotlib_citation(fig, when: Optional[datetime] = None) -> None:
    """Citazione sotto la figura; dopo tight_layout(), prima di savefig."""
    fig.subplots_adjust(bottom=0.15)
    fig.text(
        0.5, 0.01, build_citation_text(when),
        ha="center", va="bottom", fontsize=7, color="#787878", wrap=True,
    )
