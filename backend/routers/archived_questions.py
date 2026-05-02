"""
Router archivio domande obsolete (admin only).

Endpoint:
  GET    /api/admin/archived-questions
         -> lista raggruppata per original_question_id
  GET    /api/admin/archived-questions/{id}
         -> dettaglio (snapshot question + risposte/esempi/lingue)
  GET    /api/admin/archived-questions/{id}/xlsx
         -> download xlsx (sheet "Database_model")
  DELETE /api/admin/archived-questions/{id}
         -> elimina la singola versione archiviata
"""
from __future__ import annotations
import io
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from time_utils import utc_now
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, joinedload

import models
from dependencies import get_db, require_admin
from services import archive_service


router = APIRouter(prefix="/api/admin/archived-questions", tags=["ArchivedQuestions"])


XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _user_label(u: models.User | None) -> str:
    if not u:
        return "System"
    full = f"{u.name or ''} {u.surname or ''}".strip()
    return full or u.email or "System"


@router.get("")
def list_archived_questions(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    """Lista archiviazioni raggruppate per original_question_id.

    Per ogni question_id ritorna le versioni archiviate in ordine
    cronologico (piu' recente per primo). Include un piccolo preview del
    testo archiviato per la lista.
    """
    rows = (
        db.query(models.ArchivedQuestion)
        .options(joinedload(models.ArchivedQuestion.archived_by))
        .order_by(
            models.ArchivedQuestion.original_question_id,
            models.ArchivedQuestion.archived_at.desc(),
        )
        .all()
    )

    grouped: dict[str, dict] = {}
    for r in rows:
        key = r.original_question_id
        bucket = grouped.setdefault(key, {
            "original_question_id": key,
            "parameter_id": r.parameter_id,
            "parameter_name": r.parameter_name,
            "versions": [],
        })
        bucket["versions"].append({
            "id": r.id,
            "archived_at": r.archived_at.isoformat() if r.archived_at else None,
            "archived_by": _user_label(r.archived_by),
            "archive_note": r.archive_note or "",
            "answers_count": r.answers_count,
            "examples_count": r.examples_count,
            "text_preview": (r.text or "")[:160],
        })

    # Ordine: per ultimo archiviato (versione piu' recente).
    out = list(grouped.values())
    out.sort(
        key=lambda g: (
            g["versions"][0]["archived_at"] if g["versions"] else "",
        ),
        reverse=True,
    )
    return out


@router.get("/{archived_id}")
def get_archived_question_detail(
    archived_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    arch = (
        db.query(models.ArchivedQuestion)
        .options(
            joinedload(models.ArchivedQuestion.archived_by),
            joinedload(models.ArchivedQuestion.allowed_motivations),
            joinedload(models.ArchivedQuestion.answers)
                .joinedload(models.ArchivedAnswer.examples),
            joinedload(models.ArchivedQuestion.answers)
                .joinedload(models.ArchivedAnswer.answer_motivations),
        )
        .filter(models.ArchivedQuestion.id == archived_id)
        .first()
    )
    if not arch:
        raise HTTPException(status_code=404, detail="Archived question not found")

    return {
        "id": arch.id,
        "original_question_id": arch.original_question_id,
        "parameter_id": arch.parameter_id,
        "parameter_name": arch.parameter_name,
        "text": arch.text,
        "template_type": arch.template_type,
        "instruction": arch.instruction,
        "instruction_yes": arch.instruction_yes,
        "instruction_no": arch.instruction_no,
        "example_yes": arch.example_yes,
        "help_info": arch.help_info,
        "is_stop_question": arch.is_stop_question,
        "is_active": arch.is_active,
        "archived_at": arch.archived_at.isoformat() if arch.archived_at else None,
        "archived_by": _user_label(arch.archived_by),
        "archive_note": arch.archive_note or "",
        "answers_count": arch.answers_count,
        "examples_count": arch.examples_count,
        "allowed_motivations": [
            {"code": m.motivation_code, "label": m.motivation_label}
            for m in arch.allowed_motivations
        ],
        "answers": [
            {
                "id": a.id,
                "language_id": a.language_id,
                "language_name_full": a.language_name_full,
                "status": a.status,
                "response_text": a.response_text,
                "comments": a.comments,
                "original_updated_at": (
                    a.original_updated_at.isoformat()
                    if a.original_updated_at else None
                ),
                "examples": [
                    {
                        "number": ex.number,
                        "textarea": ex.textarea,
                        "transliteration": ex.transliteration,
                        "gloss": ex.gloss,
                        "translation": ex.translation,
                        "reference": ex.reference,
                    }
                    for ex in sorted(
                        a.examples, key=lambda e: (e.number or "", e.id or 0)
                    )
                ],
                "motivations": [
                    {"code": m.motivation_code, "label": m.motivation_label}
                    for m in a.answer_motivations
                ],
            }
            for a in sorted(arch.answers, key=lambda x: x.language_id)
        ],
    }


@router.get("/{archived_id}/xlsx")
def export_archived_question_xlsx(
    archived_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    arch = (
        db.query(models.ArchivedQuestion)
        .options(
            joinedload(models.ArchivedQuestion.answers)
                .joinedload(models.ArchivedAnswer.examples),
            joinedload(models.ArchivedQuestion.answers)
                .joinedload(models.ArchivedAnswer.answer_motivations),
        )
        .filter(models.ArchivedQuestion.id == archived_id)
        .first()
    )
    if not arch:
        raise HTTPException(status_code=404, detail="Archived question not found")

    wb = archive_service.build_archived_question_workbook(db, arch)
    data = archive_service.workbook_to_bytes(wb)

    ts = (arch.archived_at or utc_now()).strftime("%Y%m%d")
    fname = f"PCM_archived_{arch.original_question_id}_{ts}.xlsx"
    return StreamingResponse(
        io.BytesIO(data),
        media_type=XLSX_MIME,
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.delete("/{archived_id}")
def delete_archived_question(
    archived_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    arch = (
        db.query(models.ArchivedQuestion)
        .filter(models.ArchivedQuestion.id == archived_id)
        .first()
    )
    if not arch:
        raise HTTPException(status_code=404, detail="Archived question not found")
    db.delete(arch)
    db.commit()
    return {"detail": "Archived question deleted"}
