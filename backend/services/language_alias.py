"""Ritrova una lingua anche dopo un rename (via alias)."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from sqlalchemy.orm import Session

import models


@dataclass
class LanguageResolveResult:
    language: Optional[models.Language]
    matched_via_alias: bool = False
    glottocode_mismatch: Optional[str] = None


def resolve_language(
    db: Session,
    file_id: str,
    file_glottocode: str = "",
) -> LanguageResolveResult:
    """Glottocode diverso: non blocca, decide il chiamante."""
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
