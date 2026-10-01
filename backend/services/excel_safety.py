"""Testi sicuri per Excel: il formato xlsx vieta alcuni caratteri di controllo invisibili."""
import logging
import re

from openpyxl.cell.cell import Cell

logger = logging.getLogger(__name__)

# stessa regola di openpyxl: controlli ASCII tranne tab, a capo e ritorno carrello
_FORBIDDEN = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def clean_text(value: str) -> str:
    """Sostituisce con uno spazio i caratteri che Excel non accetta."""
    return _FORBIDDEN.sub(" ", value)


def install() -> None:
    """Fa pulire a openpyxl ogni testo prima di scriverlo, invece di interrompere l'export."""
    original = getattr(Cell, "check_string", None)
    if original is None:
        logger.warning("openpyxl senza Cell.check_string: pulizia dei testi Excel disattivata.")
        return
    if getattr(original, "_pcm_cleaning", False):
        return

    def check_string(self, value):
        if isinstance(value, str):
            value = clean_text(value)
        return original(self, value)

    check_string._pcm_cleaning = True
    Cell.check_string = check_string
