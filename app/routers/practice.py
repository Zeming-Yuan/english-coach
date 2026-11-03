"""持久练习上下文路由（EL-08）。"""

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.db import get_db
from app.runtime import Runtime, get_runtime
from app.schemas.practice import (
    CreatePracticeIn,
    PracticeAssistanceIn,
    PracticeAttemptIn,
)
from app.services.learning import CardNotFoundError, SubmissionConflictError
from app.services.practice import (
    PracticeConflictError,
    PracticeLessonNotFoundError,
    PracticeNotFoundError,
    PracticeStaleError,
    PracticeUnavailableError,
    active_sessions,
    create_session,
    get_session,
    set_assistance,
    submit_practice,
)
from app.services.questions import (
    InvalidQuestionToken,
    QuestionTokenExpired,
    QuestionTokenStale,
)

router = APIRouter()


class SceneFeedbackIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    operation_id: UUID


@router.post("/practice-sessions/{session_id}/items/{item_id}/feedback")
def feedback(
    session_id: UUID,
    item_id: UUID,
    payload: SceneFeedbackIn,
    request: Request,
    db: Session = Depends(get_db),
    runtime: Runtime = Depends(get_runtime),
):
    from app.services.scene_feedback import build_scene_feedback

    try:
        return build_scene_feedback(
            db,
            str(session_id),
            str(item_id),
            runtime,
            str(payload.operation_id),
            enabled=request.app.state.settings.scene_feedback_enabled,
        )
    except PracticeNotFoundError as error:
        raise _not_found(error)
    except (PracticeConflictError, PracticeStaleError) as error:
        raise _conflict(error)
    except PracticeUnavailableError as error:
        raise _unavailable(error)


@router.get("/practice-sessions")
def active(
    purpose: Literal["delayed_check", "targeted"],
    window: Literal["day", "week"] | None = None,
    db: Session = Depends(get_db),
):
    """恢复其他浏览器/V3 中的待处理轮次；只返回轮次身份。"""
    if (purpose == "delayed_check") != (window is not None):
        raise HTTPException(status_code=422, detail="回测需要窗口，专项练习不使用窗口")
    return {"sessions": active_sessions(db, purpose, window)}


def _not_found(error: Exception) -> HTTPException:
    return HTTPException(status_code=404, detail=str(error))


def _conflict(error: Exception) -> HTTPException:
    return HTTPException(status_code=409, detail=str(error))


def _unavailable(error: Exception) -> HTTPException:
    return HTTPException(status_code=422, detail=str(error))


@router.post("/practice-sessions")
def create(
    payload: CreatePracticeIn,
    request: Request,
    db: Session = Depends(get_db),
    runtime: Runtime = Depends(get_runtime),
):
    """创建或重放一轮课程短测；冻结题目与内容修订。"""
    if (
        payload.purpose == "story_check"
        and not request.app.state.settings.story_checks_enabled
    ):
        raise HTTPException(403, "读后入口已关闭，原文和已有检查仍可读取")
    try:
        return create_session(
            db,
            payload.id,
            payload.purpose,
            payload.lesson_id,
            payload.weak_only,
            runtime,
            payload.window,
            payload.pending_contact_ids,
            [target.model_dump() for target in payload.targets],
            payload.story_id,
            str(payload.version_id) if payload.version_id else None,
            payload.scene_id,
            request.app.state.settings.scenes_enabled
            and (
                payload.scene_id == "drinks"
                or request.app.state.settings.scene_expansions_enabled
            ),
        )
    except PermissionError as error:
        raise HTTPException(403, str(error))
    except (PracticeLessonNotFoundError, PracticeNotFoundError) as error:
        raise _not_found(error)
    except (PracticeConflictError, PracticeStaleError) as error:
        raise _conflict(error)
    except (QuestionTokenStale, QuestionTokenExpired) as error:
        raise _conflict(error)
    except (PracticeUnavailableError, InvalidQuestionToken) as error:
        raise _unavailable(error)


@router.get("/practice-sessions/{session_id}")
def read(
    session_id: UUID,
    db: Session = Depends(get_db),
    runtime: Runtime = Depends(get_runtime),
):
    """读取同一轮次；不返回未作答题目的答案、长度或音频。"""
    try:
        return get_session(db, session_id, runtime)
    except PracticeNotFoundError as error:
        raise _not_found(error)


@router.post("/practice-sessions/{session_id}/items/{item_id}/assistance")
def assistance(
    session_id: UUID,
    item_id: UUID,
    payload: PracticeAssistanceIn,
    db: Session = Depends(get_db),
    runtime: Runtime = Depends(get_runtime),
):
    """请求提示并持久标记本题辅助；提示只增不减。"""
    try:
        return set_assistance(db, session_id, item_id, payload.kind, runtime)
    except PracticeNotFoundError as error:
        raise _not_found(error)
    except PracticeStaleError as error:
        raise _conflict(error)
    except (QuestionTokenStale, QuestionTokenExpired) as error:
        raise _conflict(error)
    except (PracticeUnavailableError, InvalidQuestionToken) as error:
        raise _unavailable(error)


@router.post("/practice-sessions/{session_id}/items/{item_id}/attempts")
def attempt(
    session_id: UUID,
    item_id: UUID,
    payload: PracticeAttemptIn,
    db: Session = Depends(get_db),
    runtime: Runtime = Depends(get_runtime),
):
    """提交一题；首答结果关联真实学习事件，重复提交按标识回放。"""
    try:
        return submit_practice(db, session_id, item_id, payload, runtime)
    except PracticeNotFoundError as error:
        raise _not_found(error)
    except CardNotFoundError as error:
        raise _not_found(error)
    except (
        PracticeConflictError,
        PracticeStaleError,
        SubmissionConflictError,
    ) as error:
        raise _conflict(error)
    except (QuestionTokenStale, QuestionTokenExpired) as error:
        raise _conflict(error)
    except (PracticeUnavailableError, InvalidQuestionToken) as error:
        raise _unavailable(error)


@router.get("/scenes")
def scenes(
    request: Request,
    db: Session = Depends(get_db),
    runtime: Runtime = Depends(get_runtime),
):
    from sqlalchemy import select

    from app.models.practice import PracticeSession
    from app.services.scenes import SCENE_RULE_FILES, scene_preparation, scene_rules

    catalog = []
    for scene_id in SCENE_RULE_FILES:
        rules = scene_rules(scene_id)
        latest = db.scalar(
            select(PracticeSession)
            .where(
                PracticeSession.purpose == "scene", PracticeSession.scene_id == scene_id
            )
            .order_by(PracticeSession.created_at.desc(), PracticeSession.id.desc())
            .limit(1)
        )
        catalog.append(
            {
                "id": scene_id,
                "title": rules["title"],
                "enabled": request.app.state.settings.scenes_enabled
                and (
                    scene_id == "drinks"
                    or request.app.state.settings.scene_expansions_enabled
                ),
                "situation": rules.get("situation", "向店员购买一杯水。"),
                "task_goal": [t["goal"] for t in rules["tasks"]],
                "preparation": scene_preparation(db, runtime, rules),
                "session_id": latest.session_id if latest else None,
            }
        )
    return {
        "enabled": request.app.state.settings.scenes_enabled,
        "scenes": catalog,
    }
