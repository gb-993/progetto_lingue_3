"""Resolver Language by id corrente + fallback su alias storici.

Usato da restore di backup ed Excel import per riconoscere una lingua anche
quando il suo id corrente non corrisponde a quello salvato nel file (la
lingua e' stata rinominata via UI admin dopo l'export).

Il match via alias e' "best effort": se sia il file sia la lingua trovata
hanno il `glottocode` valorizzato e diverso, lo segnaliamo come mismatch
e l'operazione chiamante deve decidere se saltare la riga.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from sqlalchemy.orm import Session

import models


@dataclass
class LanguageResolveResult:
    """Esito del lookup di una lingua per id (eventualmente via alias).

    - `language`: l'istanza Language trovata, oppure None.
    - `matched_via_alias`: True se il match e' avvenuto sulla tabella alias
      (l'id del file differisce dall'id corrente). False se match diretto.
    - `glottocode_mismatch`: descrizione del mismatch se entrambi i
      glottocode sono valorizzati e diversi. None altrimenti.
    """
    language: Optional[models.Language]
    matched_via_alias: bool = False
    glottocode_mismatch: Optional[str] = None


def resolve_language(
    db: Session,
    file_id: str,
    file_glottocode: str = "",
) -> LanguageResolveResult:
    """Cerca una lingua per id corrente, con fallback su `language_aliases`.

    Se il match avviene via alias e sia `file_glottocode` sia
    `language.glottocode` sono valorizzati ma diversi, popola
    `glottocode_mismatch` lasciando comunque l'istanza in `language` (il
    chiamante decide se applicare o saltare).
    """
    if not file_id:
        return LanguageResolveResult(language=None)

    lang = db.query(models.Language).filter(models.Language.id == file_id).first()
    if lang is not None:
        return LanguageResolveResult(language=lang, matched_via_alias=False)

    alias = (
        db.query(models.LanguageAlias)
        .filter(models.LanguageAlias.old_id == file_id)
        .first()
    )
    if alias is None:
        return LanguageResolveResult(language=None)

    lang = db.get(models.Language, alias.language_id)
    if lang is None:
        # alias orfano (la lingua e' stata cancellata): trattalo come miss.
        return LanguageResolveResult(language=None)

    backup_g = (file_glottocode or "").strip()
    current_g = (lang.glottocode or "").strip()
    mismatch = None
    if backup_g and current_g and backup_g != current_g:
        mismatch = (
            f"Glottocode mismatch on alias '{file_id}' -> '{lang.id}': "
            f"file has '{backup_g}', current language has '{current_g}'"
        )

    return LanguageResolveResult(
        language=lang,
        matched_via_alias=True,
        glottocode_mismatch=mismatch,
    )
