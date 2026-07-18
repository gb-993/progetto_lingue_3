"""Citazione di attribuzione per i file scaricabili (xlsx/csv/txt/png/html/pdf).

Il testo si compone da EDITORS / YEAR / WORK_TITLE / VERSION: modificare quelle
costanti aggiorna la dicitura ovunque. Vedi DEV-NOTES.md per i limiti per formato.
"""
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

# Core properties del documento Excel (File -> Informazioni)
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
    """Citazione su due righe, con la data di download come "Accessed on"."""
    when = when or utc_now()
    accessed = _format_date(when)
    return (
        "Downloaded from:\n"
        f"{EDITORS} (eds). {YEAR}. {WORK_TITLE} "
        f"({VERSION}, Accessed on {accessed})"
    )


# Excel

def apply_excel_citation(wb: Workbook, when: Optional[datetime] = None) -> None:
    """Applica la citazione come footer di stampa su ogni sheet e nelle proprieta' del workbook."""
    text = build_citation_text(when)
    footer_text = "&8" + text  # `&8` imposta il font a 8 pt nella sintassi footer di Excel

    for ws in wb.worksheets:
        ws.oddFooter.center.text = footer_text
        ws.evenFooter.center.text = footer_text
        ws.firstFooter.center.text = footer_text
        # Il footer su 2 righe a 8pt richiede circa 1 pollice
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
    p.version = VERSION.split()[-1]  # "1" da "version 1"
    p.language = DOC_LANGUAGE


# PDF (fpdf2)

# Da passare a `pdf.set_auto_page_break(auto=True, margin=PDF_FOOTER_MARGIN_MM)`
PDF_FOOTER_MARGIN_MM = 28


def render_pdf_citation_footer(pdf, font_family: str) -> None:
    """Disegna linea separatrice, citazione e numero di pagina; da chiamare in `FPDF.footer()`."""
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


# Testo semplice (CSV / TSV / TXT)

def build_citation_comment(prefix: str = "# ", when: Optional[datetime] = None) -> str:
    """Citazione come righe-commento prefissate, da concatenare davanti a un file di testo."""
    text = build_citation_text(when)
    return "".join(f"{prefix}{line}\n" for line in text.split("\n"))


# HTML (pagine plotly autonome)

def render_html_citation_footer(when: Optional[datetime] = None) -> str:
    """Snippet HTML con la citazione, da iniettare in fondo a una pagina."""
    text = _html.escape(build_citation_text(when)).replace("\n", "<br>")
    return (
        '<footer style="font-family:Arial,Helvetica,sans-serif;font-size:11px;'
        'color:#787878;text-align:center;padding:12px 8px;border-top:1px solid '
        f'#dadde2;margin-top:8px">{text}</footer>'
    )


def inject_html_citation(html_str: str, when: Optional[datetime] = None) -> str:
    """Inserisce il footer di citazione prima di ``</body>`` (fallback: in coda)."""
    footer = render_html_citation_footer(when)
    if "</body>" in html_str:
        return html_str.replace("</body>", footer + "</body>", 1)
    return html_str + footer


# Immagini matplotlib (PNG)

def apply_matplotlib_citation(fig, when: Optional[datetime] = None) -> None:
    """Scrive la citazione come caption della figura; va chiamata dopo `tight_layout()` e prima di `savefig`."""
    fig.subplots_adjust(bottom=0.15)
    fig.text(
        0.5, 0.01, build_citation_text(when),
        ha="center", va="bottom", fontsize=7, color="#787878", wrap=True,
    )
