
from __future__ import annotations
from typing import List, Optional
from datetime import datetime
from time_utils import utc_now
import io
import logging
import math
import os
import zipfile

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func, or_

import models
from database import SessionLocal
from dependencies import get_db, get_current_user, require_admin
from services.excel_export import (
    build_language_workbook,
    build_language_list_workbook,
    build_schema_workbook,
    build_glossary_workbook,
    build_backup_zip_bytes,
    build_full_backup_zip_bytes,
)
from services.pdf_export import build_language_pdf
from services.citation import build_citation_comment
from services import export_jobs


logger = logging.getLogger(__name__)


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
    return utc_now().strftime("%Y%m%d")



@router.get("/export/language/{lang_id}/xlsx")
def export_single_language(
    lang_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    lang = db.query(models.Language).filter(models.Language.id == lang_id).first()
    if not lang:
        raise HTTPException(status_code=404, detail="Language not found")

    is_admin = current_user.role == "admin"
    if not is_admin and lang.assigned_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="You cannot export this language.")

    wb = build_language_workbook(db, lang, is_admin=is_admin)
    suffix = "full" if is_admin else "examples"
    return _xlsx_response(wb, f"PCM_{lang.id}_{suffix}_{_ts()}.xlsx")


@router.get("/export/language/{lang_id}/pdf")
def export_single_language_pdf(
    lang_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):

    lang = db.query(models.Language).filter(models.Language.id == lang_id).first()
    if not lang:
        raise HTTPException(status_code=404, detail="Language not found")

    pdf_bytes = build_language_pdf(db, lang)
    filename = f"PCM_{lang.id}_parametric_data_{_ts()}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )



class LanguageListExportPayload(BaseModel):
    lang_ids: List[str] = []


@router.post("/admin/export/languages-list/xlsx")
def export_language_list(
    payload: LanguageListExportPayload,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    q = db.query(models.Language).order_by(func.lower(models.Language.id))
    if payload.lang_ids:
        q = q.filter(models.Language.id.in_(payload.lang_ids))
    languages = q.all()

    wb = build_language_list_workbook(db, languages)
    return _xlsx_response(wb, f"PCM_languages_{_ts()}.xlsx")




def _run_backup_in_background(payload_lang_ids: Optional[List[str]], job_id: str) -> None:
    db = SessionLocal()
    try:
        q = db.query(models.Language).order_by(func.lower(models.Language.id))
        if payload_lang_ids:
            q = q.filter(models.Language.id.in_(payload_lang_ids))
        languages = q.all()

        if not languages:
            export_jobs.finish_error(job_id, "No language to export.")
            return

        total = len(languages)
        export_jobs.set_phase(job_id, "building", "Building backup…", total=total)

        def on_lang(idx: int, total_count: int, lang) -> None:
            export_jobs.tick(
                job_id,
                current=idx,
                label=f"Processing {lang.id} ({idx}/{total_count})",
            )

        data = build_backup_zip_bytes(db, languages, on_language=on_lang)

        target = export_jobs.get_target_path(job_id)
        with open(target, "wb") as f:
            f.write(data)
        export_jobs.set_file_ready(job_id, target)
    except Exception as e:
        logger.exception("Backup export job %s failed", job_id)
        export_jobs.finish_error(job_id, f"Unexpected error: {e}")
    finally:
        db.close()


@router.post("/admin/export/languages/zip")
def start_export_languages_zip(
    payload: LanguageListExportPayload,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    q = db.query(models.Language.id)
    if payload.lang_ids:
        q = q.filter(models.Language.id.in_(payload.lang_ids))
    if q.count() == 0:
        raise HTTPException(status_code=400, detail="No language to export.")

    job_id = export_jobs.new_job()
    background_tasks.add_task(_run_backup_in_background, payload.lang_ids, job_id)
    return {"job_id": job_id}


@router.get("/admin/export/languages/zip/status/{job_id}")
def get_export_status(
    job_id: str,
    current_user: models.User = Depends(require_admin),
):
    state = export_jobs.get_state(job_id)
    if state is None:
        raise HTTPException(status_code=404, detail="Job not found or expired")
    return state


@router.get("/admin/export/languages/zip/download/{job_id}")
def download_export(
    job_id: str,
    background_tasks: BackgroundTasks,
    current_user: models.User = Depends(require_admin),
):
    state = export_jobs.get_state(job_id)
    if state is None:
        raise HTTPException(status_code=404, detail="Job not found or expired")
    if not state.get("finished"):
        raise HTTPException(status_code=409, detail="Job not finished yet")
    if state.get("error"):
        raise HTTPException(status_code=500, detail=state["error"])

    path = export_jobs.consume_file(job_id)
    if path is None or not os.path.exists(path):
        raise HTTPException(status_code=410, detail="File already downloaded or expired")

    fname = f"PCM_backup_{_ts()}.zip"
    background_tasks.add_task(export_jobs.cleanup_file, path)
    return FileResponse(
        path=path,
        media_type=ZIP_MIME,
        filename=fname,
    )




def _run_full_backup_in_background(job_id: str) -> None:
    db = SessionLocal()
    try:
        languages = (
            db.query(models.Language)
            .order_by(func.lower(models.Language.id))
            .all()
        )
        if not languages:
            export_jobs.finish_error(job_id, "No language to export.")
            return

        total = len(languages)
        export_jobs.set_phase(job_id, "building", "Building full backup…", total=total)

        def on_lang(idx: int, total_count: int, lang) -> None:
            export_jobs.tick(
                job_id,
                current=idx,
                label=f"Processing {lang.id} ({idx}/{total_count})",
            )

        data = build_full_backup_zip_bytes(db, languages, on_language=on_lang)

        target = export_jobs.get_target_path(job_id)
        with open(target, "wb") as f:
            f.write(data)
        export_jobs.set_file_ready(job_id, target)
    except Exception as e:
        logger.exception("Full backup export job %s failed", job_id)
        export_jobs.finish_error(job_id, f"Unexpected error: {e}")
    finally:
        db.close()


@router.post("/admin/export/full-backup/zip")
def start_export_full_backup_zip(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    if db.query(models.Language.id).count() == 0:
        raise HTTPException(status_code=400, detail="No language to export.")

    job_id = export_jobs.new_job()
    background_tasks.add_task(_run_full_backup_in_background, job_id)
    return {"job_id": job_id}


@router.get("/admin/export/full-backup/zip/status/{job_id}")
def get_full_backup_status(
    job_id: str,
    current_user: models.User = Depends(require_admin),
):
    state = export_jobs.get_state(job_id)
    if state is None:
        raise HTTPException(status_code=404, detail="Job not found or expired")
    return state


@router.get("/admin/export/full-backup/zip/download/{job_id}")
def download_full_backup(
    job_id: str,
    background_tasks: BackgroundTasks,
    current_user: models.User = Depends(require_admin),
):
    state = export_jobs.get_state(job_id)
    if state is None:
        raise HTTPException(status_code=404, detail="Job not found or expired")
    if not state.get("finished"):
        raise HTTPException(status_code=409, detail="Job not finished yet")
    if state.get("error"):
        raise HTTPException(status_code=500, detail=state["error"])

    path = export_jobs.consume_file(job_id)
    if path is None or not os.path.exists(path):
        raise HTTPException(status_code=410, detail="File already downloaded or expired")

    fname = f"PCM_full_backup_{_ts()}.zip"
    background_tasks.add_task(export_jobs.cleanup_file, path)
    return FileResponse(
        path=path,
        media_type=ZIP_MIME,
        filename=fname,
    )




def _gcd_nautical_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:

    x1, y1 = math.radians(lat1), math.radians(lon1)
    x2, y2 = math.radians(lat2), math.radians(lon2)
    cos_val = math.sin(x1) * math.sin(x2) + math.cos(x1) * math.cos(x2) * math.cos(y1 - y2)
    angle_rad = math.acos(round(cos_val, 5))
    return 60.0 * math.degrees(angle_rad)


@router.post("/admin/export/languages/gcd-txt")
def export_languages_gcd(
    payload: LanguageListExportPayload,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    q = db.query(models.Language).order_by(func.lower(models.Language.id))
    if payload.lang_ids:
        q = q.filter(models.Language.id.in_(payload.lang_ids))
    languages = q.all()

    if not languages:
        raise HTTPException(status_code=400, detail="No language to export.")

    with_coords = [l for l in languages if l.latitude is not None and l.longitude is not None]
    skipped = [l.id for l in languages if l.latitude is None or l.longitude is None]

    if not with_coords:
        raise HTTPException(status_code=400, detail="None of the selected languages has coordinates.")

    ids = [l.id for l in with_coords]
    coords = [(float(l.latitude), float(l.longitude)) for l in with_coords]

    lines = ["\t" + "\t".join(ids)]
    for i, id1 in enumerate(ids):
        row = [id1]
        for j in range(len(ids)):
            row.append(str(_gcd_nautical_miles(coords[i][0], coords[i][1],
                                               coords[j][0], coords[j][1])))
        lines.append("\t".join(row))
    content = build_citation_comment() + "\n".join(lines) + "\n"

    headers = {"Content-Disposition": f'attachment; filename="gcd_{_ts()}.txt"'}
    if skipped:
        headers["X-Skipped-Languages"] = ",".join(skipped)

    return Response(content=content, media_type="text/plain; charset=utf-8", headers=headers)



@router.get("/admin/export/schema/xlsx")
def export_schema(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    wb = build_schema_workbook(db)
    return _xlsx_response(wb, f"PCM_schema_{_ts()}.xlsx")
