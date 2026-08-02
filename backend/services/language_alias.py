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
    """Esito del lookup: `matched_via_alias` se il match è avvenuto via alias invece che per id diretto; `glottocode_mismatch` è valorizzato solo in quel caso se i glottocode di file e lingua corrente divergono."""
    language: Optional[models.Language]
    matched_via_alias: bool = False
    glottocode_mismatch: Optional[str] = None


def resolve_language(
    db: Session,
    file_id: str,
    file_glottocode: str = "",
) -> LanguageResolveResult:
    """Cerca una lingua per id corrente con fallback su `language_aliases`; in caso di mismatch sul glottocode non blocca, popola `glottocode_mismatch` e lascia al chiamante decidere se applicare o saltare."""
    if not file_id:
        return LanguageResolveResult(language=None)

    language = db.query(models.Language).filter(models.Language.id == file_id).first()
    if language is not None:
        return LanguageResolveResult(language=language, matched_via_alias=False)

    alias = (
        db.query(models.LanguageAlias)
        .filter(models.LanguageAlias.old_id == file_id)
        .first()
    )
    if alias is None:
        return LanguageResolveResult(language=None)

    language = db.get(models.Language, alias.language_id)
    if language is None:
        return LanguageResolveResult(language=None)

    incoming_glottocode = (file_glottocode or "").strip()
    existing_glottocode = (language.glottocode or "").strip()
    mismatch = None
    if incoming_glottocode and existing_glottocode and incoming_glottocode != existing_glottocode:
        mismatch = (
            f"Glottocode mismatch on alias '{file_id}' -> '{language.id}': "
            f"file has '{incoming_glottocode}', current language has '{existing_glottocode}'"
        )

    return LanguageResolveResult(
        language=language,
        matched_via_alias=True,
        glottocode_mismatch=mismatch,
    )
