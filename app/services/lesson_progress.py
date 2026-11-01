"""课程学习状态：生成、打开、浏览确认与后续检查结果。

生成只说明内容存在；打开与浏览必须分开记录；尚无短测时保持待检查，
不能用生成数量、打开或浏览动作冒充掌握。
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.lesson import Lesson
from app.models.lesson_progress import LessonProgress
from app.runtime import Runtime
from app.services.content_revisions import get_content_revision
from app.services.write_transaction import run_write


class LessonNotFoundError(LookupError):
    """课程不存在。"""


class LessonViewConflictError(RuntimeError):
    """浏览确认的提交标识或内容修订与当前状态冲突。"""


def lesson_status(generated: bool, browsed: bool, checked: int, passed: int) -> str:
    if not generated:
        return "unavailable"
    if checked > 0:
        return "passed" if passed == checked else "weak"
    return "browsed" if browsed else "unrecorded"


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.replace(tzinfo=UTC).isoformat()


def progress_payload(row: LessonProgress | None) -> dict:
    if row is None:
        return {
            "status": lesson_status(True, False, 0, 0),
            "tracked": False,
            "generated": False,
            "opened": False,
            "opened_at": None,
            "browsed_at": None,
            "checked_count": 0,
            "passed_count": 0,
        }
    return {
        "status": lesson_status(
            True, row.browsed, row.checked_count, row.passed_count
        ),
        "tracked": True,
        "generated": row.generated,
        "opened": row.opened,
        "opened_at": _iso(row.opened_at),
        "browsed_at": _iso(row.browsed_at),
        "checked_count": row.checked_count,
        "passed_count": row.passed_count,
    }


def _lesson(session: Session, level: int) -> Lesson:
    lesson = (
        session.execute(select(Lesson).where(Lesson.level == level))
        .scalars()
        .first()
    )
    if lesson is None:
        raise LessonNotFoundError("课程不存在")
    return lesson


def _row(session: Session, lesson_id: int) -> LessonProgress | None:
    return (
        session.execute(
            select(LessonProgress).where(LessonProgress.lesson_id == lesson_id)
        )
        .scalars()
        .first()
    )


def record_lesson_opened(db: Session, level: int, runtime: Runtime) -> dict:
    """记录“打开了课程”；同一课只保留首次打开时间。"""

    def operation(session: Session) -> dict:
        lesson = _lesson(session, level)
        row = _row(session, lesson.id)
        now = runtime.clock.now().astimezone(UTC).replace(tzinfo=None)
        if row is None:
            row = LessonProgress(
                lesson_id=lesson.id,
                generation_id=str(uuid4()),
                generated=False,
                # 旧课使用已知的内容创建时间，不伪造“今天生成”。
                generated_at=lesson.created_at or now,
                opened=True,
                opened_at=now,
            )
            session.add(row)
        elif not row.opened:
            row.opened = True
            row.opened_at = now
        session.flush()
        return progress_payload(row)

    return run_write(db, operation)


def record_lesson_viewed(
    db: Session,
    level: int,
    submission_id,
    revision: dict,
    runtime: Runtime,
) -> dict:
    """显式看完课程：提交标识幂等，不把打开或浏览当成短测通过。"""

    def operation(session: Session) -> dict:
        lesson = _lesson(session, level)
        submission = str(submission_id)
        # 任一历史确认过的提交重放都不改写最新浏览时间。
        for row in session.execute(
            select(LessonProgress).where(LessonProgress.browsed)
        ).scalars():
            seen = [row.view_submission_id, *(row.view_submissions or [])]
            if submission in seen:
                if row.lesson_id != lesson.id:
                    raise LessonViewConflictError(
                        "该提交标识已用于其他课程的浏览确认"
                    )
                return progress_payload(row)
        if get_content_revision(session, "lesson", lesson.id) != revision:
            raise LessonViewConflictError("课程内容已变化，请重新打开后再确认")
        row = _row(session, lesson.id)
        now = runtime.clock.now().astimezone(UTC).replace(tzinfo=None)
        if row is None:
            row = LessonProgress(
                lesson_id=lesson.id,
                generation_id=str(uuid4()),
                generated=False,
                # 旧课使用已知的内容创建时间，不伪造“今天生成”。
                generated_at=lesson.created_at or now,
            )
            session.add(row)
        history = [*(row.view_submissions or [])]
        if row.view_submission_id is not None:
            history.append(row.view_submission_id)
        row.opened = True
        row.opened_at = row.opened_at or now
        row.browsed = True
        row.browsed_at = now
        row.view_submissions = history
        row.view_submission_id = submission
        session.flush()
        return progress_payload(row)

    return run_write(db, operation)


__all__ = [
    "LessonNotFoundError",
    "LessonViewConflictError",
    "lesson_status",
    "progress_payload",
    "record_lesson_opened",
    "record_lesson_viewed",
]
