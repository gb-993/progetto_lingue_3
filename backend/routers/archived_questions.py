"""Router archivio domande obsolete (admin only)."""
from __future__ import annotations
import io

from fastapi import APIRouter, Depends, HTTPException
from time_utils import utc_now
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, joinedload

import models
from dependencies import get_db, require_admin
from services import archive_service


router = APIRouter(prefix="/api/admin/archived-questions", tags=["ArchivedQuestions"])


XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _user_label(user: models.User | None) -> str:
    if not user:
        return "System"
    full = f"{user.name or ''} {user.surname or ''}".strip()
    return full or user.email or "System"


@router.get("")
def list_archived_questions(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    archived_questions = (
        db.query(models.ArchivedQuestion)
        .options(joinedload(models.ArchivedQuestion.archived_by))
        .order_by(
            models.ArchivedQuestion.original_question_id,
            models.ArchivedQuestion.archived_at.desc(),
        )
        .all()
    )

    groups_by_question_id: dict[str, dict] = {}
    for archived_question in archived_questions:
        original_question_id = archived_question.original_question_id
        group = groups_by_question_id.setdefault(original_question_id, {
            "original_question_id": original_question_id,
            "parameter_id": archived_question.parameter_id,
            "parameter_name": archived_question.parameter_name,
            "versions": [],
        })
        group["versions"].append({
            "id": archived_question.id,
            "archived_at": archived_question.archived_at.isoformat() if archived_question.archived_at else None,
            "archived_by": _user_label(archived_question.archived_by),
            "archive_note": archived_question.archive_note or "",
            "answers_count": archived_question.answers_count,
            "examples_count": archived_question.examples_count,
            "text_preview": (archived_question.text or "")[:160],
        })

    # Ordine: per ultimo archiviato (versione più recente).
    groups = list(groups_by_question_id.values())
    groups.sort(
        key=lambda group: (
            group["versions"][0]["archived_at"] if group["versions"] else "",
        ),
        reverse=True,
    )
    return groups


@router.get("/{archived_id}")
def get_archived_question_detail(
    archived_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    archived_question = (
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
    if not archived_question:
        raise HTTPException(status_code=404, detail="Archived question not found")

    return {
        "id": archived_question.id,
        "original_question_id": archived_question.original_question_id,
        "parameter_id": archived_question.parameter_id,
        "parameter_name": archived_question.parameter_name,
        "text": archived_question.text,
        "template_type": archived_question.template_type,
        "instruction": archived_question.instruction,
        "instruction_yes": archived_question.instruction_yes,
        "instruction_no": archived_question.instruction_no,
        "example_yes": archived_question.example_yes,
        "help_info": archived_question.help_info,
        "is_stop_question": archived_question.is_stop_question,
        "is_active": archived_question.is_active,
        "archived_at": archived_question.archived_at.isoformat() if archived_question.archived_at else None,
        "archived_by": _user_label(archived_question.archived_by),
        "archive_note": archived_question.archive_note or "",
        "answers_count": archived_question.answers_count,
        "examples_count": archived_question.examples_count,
        "allowed_motivations": [
            {"code": motivation.motivation_code, "label": motivation.motivation_label}
            for motivation in archived_question.allowed_motivations
        ],
        "answers": [
            {
                "id": answer.id,
                "language_id": answer.language_id,
                "language_name_full": answer.language_name_full,
                "status": answer.status,
                "response_text": answer.response_text,
                "comments": answer.comments,
                "original_updated_at": (
                    answer.original_updated_at.isoformat()
                    if answer.original_updated_at else None
                ),
                "examples": [
                    {
                        "number": example.number,
                        "textarea": example.textarea,
                        "transliteration": example.transliteration,
                        "gloss": example.gloss,
                        "translation": example.translation,
                        "reference": example.reference,
                    }
                    for example in sorted(
                        answer.examples, key=lambda example: (example.number or "", example.id or 0)
                    )
                ],
                "motivations": [
                    {"code": motivation.motivation_code, "label": motivation.motivation_label}
                    for motivation in answer.answer_motivations
                ],
            }
            for answer in sorted(archived_question.answers, key=lambda answer: answer.language_id)
        ],
    }


@router.get("/{archived_id}/xlsx")
def export_archived_question_xlsx(
    archived_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    archived_question = (
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
    if not archived_question:
        raise HTTPException(status_code=404, detail="Archived question not found")

    workbook = archive_service.build_archived_question_workbook(db, archived_question)
    data = archive_service.workbook_to_bytes(workbook)

    timestamp = (archived_question.archived_at or utc_now()).strftime("%Y%m%d")
    filename = f"PCM_archived_{archived_question.original_question_id}_{timestamp}.xlsx"
    return StreamingResponse(
        io.BytesIO(data),
        media_type=XLSX_MIME,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.delete("/{archived_id}")
def delete_archived_question(
    archived_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    archived_question = (
        db.query(models.ArchivedQuestion)
        .filter(models.ArchivedQuestion.id == archived_id)
        .first()
    )
    if not archived_question:
        raise HTTPException(status_code=404, detail="Archived question not found")
    db.delete(archived_question)
    db.commit()
    return {"detail": "Archived question deleted"}
