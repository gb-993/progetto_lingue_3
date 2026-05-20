"""
Citazione di attribuzione per i materiali scaricati dal PCM_Hub.

Ogni file (Excel o PDF) prodotto dagli endpoint di export deve riportare la
dicitura concordata con i linguisti. La data "Accessed on" e' quella del
download (UTC, generata al momento del build).

Uso:
  - Excel: chiamare ``apply_excel_citation(wb)`` dopo aver popolato il
    workbook. La funzione setta su ogni sheet il footer di stampa con la
    citazione. Nota: XLSX non supporta footer visibili a schermo in vista
    Normale (limite del formato): la dicitura compare nell'anteprima di
    stampa, in stampa, nei PDF generati da Excel e nella vista "Layout di
    pagina". I dati restano leggibili nella vista Normale.
  - PDF: usare la classe base ``CitationFooterReport`` (sottoclasse di FPDF)
    al posto di FPDF; il suo ``footer()`` rendera' la citazione + il numero
    di pagina. Le sottoclassi devono solo definire ``header()``.

Per modificare la dicitura, intervenire sulle costanti EDITORS / YEAR /
WORK_TITLE / VERSION qui sotto: il testo viene composto in un solo punto
e propagato ovunque.
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

# ----------------------------------------------------------------------------
# Document core properties (visibili in File -> Informazioni e Esplora risorse).
# I campi "Societa'" (Company) e "Responsabile" (Manager) sono in app.xml,
# che openpyxl non espone: se servissero, occorrerebbe post-processing del
# file .xlsx come zip. Per ora si tengono solo le core properties.
# ----------------------------------------------------------------------------
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
    """
    Stringa multilinea della citazione, con la data di download.

    Esempio output:
        Downloaded from:
        Guardiano, Cristina, ... Gaia Sorge (eds). 2026. The PCM_Hub
        (version 1, Accessed on 04/05/2026)
    """
    when = when or utc_now()
    accessed = _format_date(when)
    return (
        "Downloaded from:\n"
        f"{EDITORS} (eds). {YEAR}. {WORK_TITLE} "
        f"({VERSION}, Accessed on {accessed})"
    )


# ----------------------------------------------------------------------------
# Excel
# ----------------------------------------------------------------------------

def apply_excel_citation(wb: Workbook, when: Optional[datetime] = None) -> None:
    """
    Applica la citazione come footer di stampa su ogni sheet e popola le
    proprieta' core del documento (visibili in File -> Informazioni).

    Effetti collaterali per sheet:
      - ``oddFooter.center.text``: la dicitura (font 8) su 2 righe.
      - ``page_margins.bottom``: aumentato a 1.0" per dare spazio al footer
        in stampa / anteprima / esportazione PDF.

    Effetti sul workbook:
      - ``wb.properties``: title/creator/lastModifiedBy/description/subject/
        keywords/category/version/language popolati dalle costanti DOC_*.
        ``description`` contiene la citazione completa (cosi' i linguisti la
        trovano anche nel campo "Commenti" delle proprieta').

    Il file resta in vista Normale: i dati sono leggibili senza ricalcolo
    delle larghezze. Per vedere il footer a schermo l'utente deve passare
    in "Layout di pagina" (Visualizza -> Layout di pagina) o aprire
    l'anteprima di stampa.

    Sicuro da chiamare su workbook gia' popolati; non altera dati o tabelle.
    """
    text = build_citation_text(when)
    # `&8` davanti al testo forza la dimensione font a 8 pt nel footer Excel.
    footer_text = "&8" + text

    for ws in wb.worksheets:
        ws.oddFooter.center.text = footer_text
        ws.evenFooter.center.text = footer_text
        ws.firstFooter.center.text = footer_text
        # Margine inferiore generoso: il footer su 2 righe a 8pt richiede ~1".
        ws.page_margins.bottom = 1.0
        ws.page_margins.footer = 0.3

    # Core document properties
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


# ----------------------------------------------------------------------------
# PDF (fpdf2)
# ----------------------------------------------------------------------------

# Margine inferiore (in mm) richiesto dal footer con citazione + page number.
# Usare come `pdf.set_auto_page_break(auto=True, margin=PDF_FOOTER_MARGIN_MM)`.
PDF_FOOTER_MARGIN_MM = 28


def render_pdf_citation_footer(pdf, font_family: str) -> None:
    """
    Rendera' nel footer di una pagina PDF: linea separatrice, citazione su
    piu' righe (font italic 7) e ``Page N`` centrato.

    Pensata per essere chiamata da ``FPDF.footer()``. Si assume che i font
    bundled di fpdf2 (con stile "I") siano gia' registrati sul ``pdf``.
    """
    # Linea separatrice 22mm dal fondo
    pdf.set_y(-22)
    pdf.set_draw_color(218, 221, 226)
    pdf.line(10, pdf.get_y(), 200, pdf.get_y())

    # Citazione, due righe, font italic piccolo grigio chiaro
    pdf.set_y(-20)
    pdf.set_font(font_family, style="I", size=7)
    pdf.set_text_color(120, 120, 120)
    pdf.multi_cell(0, 3, build_citation_text(), align="C")

    # Numero di pagina sotto la citazione
    pdf.set_y(-9)
    pdf.set_font(font_family, style="I", size=8)
    pdf.set_text_color(97, 101, 107)
    pdf.cell(0, 5, f"Page {pdf.page_no()}", align="C")


# ----------------------------------------------------------------------------
# Testo semplice (CSV / TSV / TXT)
# ----------------------------------------------------------------------------

def build_citation_comment(prefix: str = "# ", when: Optional[datetime] = None) -> str:
    """
    Citazione come blocco di righe-commento, da anteporre a file di testo
    (CSV/TSV/TXT). Ogni riga è prefissata (default ``# ``) e il blocco termina
    con una newline, così basta concatenarlo davanti al contenuto.

    Esempio (prefix di default)::

        # Downloaded from:
        # Guardiano, Cristina, ... Gaia Sorge (eds). 2026. The PCM_Hub (version 1, Accessed on 20/05/2026)
    """
    text = build_citation_text(when)
    return "".join(f"{prefix}{line}\n" for line in text.split("\n"))


# ----------------------------------------------------------------------------
# HTML (pagine plotly autonome)
# ----------------------------------------------------------------------------

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


# ----------------------------------------------------------------------------
# Immagini matplotlib (PNG)
# ----------------------------------------------------------------------------

def apply_matplotlib_citation(fig, when: Optional[datetime] = None) -> None:
    """
    Scrive la citazione come caption in fondo a una figura matplotlib.

    Va chiamata DOPO ``tight_layout()`` e prima di ``savefig``. Si appoggia a
    ``bbox_inches="tight"`` nel savefig per includere la caption senza
    tagliarla. Lascia spazio in basso riducendo il margine inferiore degli assi.
    """
    fig.subplots_adjust(bottom=0.15)
    fig.text(
        0.5, 0.01, build_citation_text(when),
        ha="center", va="bottom", fontsize=7, color="#787878", wrap=True,
    )
