"""学习观察请求：应用内接触确认。

只处理“看到了/听到了”的观察；不参与判分、排期或每日完成。
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.runtime import Runtime, get_runtime
from app.schemas.learning import ContactCommand
from app.services.contacts import (
    ContactRevisionConflictError,
    ContactSubmissionConflictError,
    ContactTargetNotFoundError,
    record_contact,
)

router = APIRouter()


@router.post("/learning/contacts")
def create_contact(
    payload: ContactCommand,
    db: Session = Depends(get_db),
    runtime: Runtime = Depends(get_runtime),
):
    """确认一次实际展示或播放；重复提交去重，不写学习事件或排期。"""
    try:
        return record_contact(db, payload, runtime)
    except ContactTargetNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error))
    except (ContactRevisionConflictError, ContactSubmissionConflictError) as error:
        raise HTTPException(status_code=409, detail=str(error))
