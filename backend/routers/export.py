"""
Router di export Excel.

Endpoint:
  GET  /api/export/language/{lang_id}/xlsx        -> singola lingua (admin: 7 sheet, user: 1 sheet)
  POST /api/admin/export/languages-list/xlsx       -> metadata di lingue selezionate (admin)
  POST /api/admin/export/languages/zip             -> ZIP con un xlsx per lingua (admin)
  GET  /api/admin/export/schema/xlsx               -> schema only (parametri/domande/motivazioni) (admin)
"""
from __future__ import annotations
from typing import List, Optional
from datetime import datetime
import io
import zipfile

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import or_

import models
from dependencies import get_db, get_current_user, require_admin
from services.excel_export import (
    build_language_workbook,
    build_language_list_workbook,
    build_schema_workbook,
)


router = APIRouter(prefix="/api", tags=["Export"])


XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
ZIP_MIME = "application/zip"


def _xlsx_response(wb, filename: str) -> StreamingResponse:
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type=XLSX_MIME,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _ts() -> str:
    return datetime.utcnow().strftime("%Y%m%d")


# ============================================================================
# 1. Single language export (admin: full, user: examples-only)
# ============================================================================

@router.get("/export/language/{lang_id}/xlsx")
def export_single_language(
    lang_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    lang = db.query(models.Language).filter(models.Language.id == lang_id).first()
    if not lang:
        raise HTTPException(status_code=404, detail="Lingua non trovata")

    is_admin = current_user.role == "admin"
    if not is_admin and lang.assigned_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Non puoi esportare questa lingua.")

    wb = build_language_workbook(db, lang, is_admin=is_admin)
    suffix = "full" if is_admin else "examples"
    return _xlsx_response(wb, f"PCM_{lang.id}_{suffix}_{_ts()}.xlsx")


# ============================================================================
# 2. Languages list export (admin only, supporta selezione + filtri lato client)
# ============================================================================

class LanguageListExportPayload(BaseModel):
    # IDs selezionati (vuoto = tutte). I filtri lato client sono già applicati alla
    # selezione, quindi qui basta la lista degli ID.
    lang_ids: List[str] = []


@router.post("/admin/export/languages-list/xlsx")
def export_language_list(
    payload: LanguageListExportPayload,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    q = db.query(models.Language).order_by(models.Language.position, models.Language.name_full)
    if payload.lang_ids:
        q = q.filter(models.Language.id.in_(payload.lang_ids))
    languages = q.all()

    wb = build_language_list_workbook(db, languages)
    return _xlsx_response(wb, f"PCM_languages_{_ts()}.xlsx")


# ============================================================================
# 3. ZIP di lingue (un xlsx per lingua, admin only)
# ============================================================================

@router.post("/admin/export/languages/zip")
def export_languages_zip(
    payload: LanguageListExportPayload,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    q = db.query(models.Language).order_by(models.Language.position, models.Language.id)
    if payload.lang_ids:
        q = q.filter(models.Language.id.in_(payload.lang_ids))
    languages = q.all()

    if not languages:
        raise HTTPException(status_code=400, detail="Nessuna lingua da esportare.")

    ts = _ts()
    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for lang in languages:
            wb = build_language_workbook(db, lang, is_admin=True)
            inner = io.BytesIO()
            wb.save(inner)
            inner.seek(0)
            zf.writestr(f"PCM_{lang.id}_full_{ts}.xlsx", inner.getvalue())

    zip_buf.seek(0)
    fname = f"PCM_languages_selected_{ts}.zip" if payload.lang_ids else f"PCM_languages_full_{ts}.zip"
    return StreamingResponse(
        zip_buf,
        media_type=ZIP_MIME,
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


# ============================================================================
# 4. Schema export (admin, da ParameterList)
# ============================================================================

@router.get("/admin/export/schema/xlsx")
def export_schema(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    wb = build_schema_workbook(db)
    return _xlsx_response(wb, f"PCM_schema_{_ts()}.xlsx")
