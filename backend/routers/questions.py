from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

import models
from dependencies import get_db, require_admin

router = APIRouter(prefix="/api/admin/questions", tags=["Questions"])


@router.get("")
def get_admin_questions(db: Session = Depends(get_db), current_user: models.User = Depends(require_admin)):
    questions = db.query(models.Question).all()
    return questions

