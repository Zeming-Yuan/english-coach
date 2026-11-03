"""学习观察请求：应用内接触确认与主动时长。

接触与时长均不参与判分、排期或每日完成。
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.runtime import Runtime, get_runtime
from app.schemas.duration import DurationCommand
from app.schemas.learning import ContactCommand
from app.services.contacts import (
    ContactRevisionConflictError,
    ContactSubmissionConflictError,
    ContactTargetNotFoundError,
    record_contact,
)
from app.services.practice_durations import record_duration

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


@router.post("/learning/durations")
def create_duration(
    payload: DurationCommand,
    db: Session = Depends(get_db),
    runtime: Runtime = Depends(get_runtime),
):
    return record_duration(db, payload, runtime)
