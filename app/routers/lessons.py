"""课程路由：查进度 / 生成下一课 / 读课程详情 / 显式浏览确认。"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.card import Card
from app.models.lesson import Lesson
from app.models.lesson_progress import LessonProgress
from app.runtime import Runtime, get_runtime
from app.services.contacts import visible_card_ids
from app.services.content_revisions import content_revision_map, get_content_revision
from app.services.lesson_generator import (
    MAX_LEVEL,
    LessonCapReachedError,
    LessonLevelConflictError,
    generate_next_lesson,
    lesson_goal,
)
from app.services.lesson_progress import (
    LessonNotFoundError,
    LessonViewConflictError,
    progress_payload,
    record_lesson_opened,
    record_lesson_viewed,
)

router = APIRouter()


class GenerateLessonIn(BaseModel):
    operation_id: UUID | None = None


class LessonRevisionIn(BaseModel):
    identity: UUID
    version: int = Field(ge=1)


class ViewLessonIn(BaseModel):
    submission_id: UUID
    revision: LessonRevisionIn


def lesson_to_dict(
    lesson: Lesson,
    db: Session,
    revision: dict | None = None,
    progress: LessonProgress | None = None,
) -> dict:
    """Lesson → 字典（含目标、当前修订和学习状态）。"""
    return {
        "id": lesson.id,
        "level": lesson.level,
        "title": lesson.title,
        "content": lesson.content,
        "created_at": lesson.created_at,
        "goal": lesson_goal(lesson.level),
        "content_revision": revision
        or get_content_revision(db, "lesson", lesson.id),
        "learning_progress": progress_payload(progress),
    }


def _lesson_word_cards(lesson: Lesson, db: Session) -> list[dict]:
    """课程词表对应的真实词卡与修订；没有词卡的目标不伪造接触。"""
    words = lesson.content.get("words", [])
    names = [word.get("word") for word in words if word.get("word")]
    cards = (
        db.execute(
            select(Card).where(Card.kind == "word", Card.word.in_(names))
        )
        .scalars()
        .all()
    )
    by_word = {card.word: card for card in cards}
    revisions = content_revision_map(db, "card", [card.id for card in cards])
    result = []
    for word in words:
        card = by_word.get(word.get("word"))
        if card is None:
            continue
        result.append(
            {
                "id": card.id,
                "word": card.word,
                "phonetic": word.get("phonetic") or card.phonetic,
                "meaning": word.get("meaning") or card.meaning,
                "content_revision": revisions[card.id],
            }
        )
    return result


def _lesson_detail(lesson: Lesson, db: Session) -> dict:
    words = _lesson_word_cards(lesson, db)
    dialogue = [
        {
            **line,
            "visible_card_ids": visible_card_ids(line.get("en", ""), words),
        }
        for line in lesson.content.get("dialogue", [])
    ]
    progress = (
        db.execute(
            select(LessonProgress).where(LessonProgress.lesson_id == lesson.id)
        )
        .scalars()
        .first()
    )
    return {
        **lesson_to_dict(lesson, db, progress=progress),
        "card_ids": {word["word"]: word["id"] for word in words},
        "words": words,
        "dialogue": dialogue,
        # 词表整行打开即显示；对话内再次出现不制造重复身份。
        "visible_card_ids": [word["id"] for word in words],
    }


@router.get("/lessons")
def list_lessons(db: Session = Depends(get_db)):
    """课程列表 + 生成/浏览计数；生成不等于学完。"""
    lessons = db.execute(select(Lesson).order_by(Lesson.level)).scalars().all()
    revisions = content_revision_map(db, "lesson", [lesson.id for lesson in lessons])
    progress_rows = {
        row.lesson_id: row
        for row in db.execute(
            select(LessonProgress).where(
                LessonProgress.lesson_id.in_([lesson.id for lesson in lessons])
            )
        ).scalars()
    }
    max_level = db.execute(select(func.max(Lesson.level))).scalar_one()
    next_level = min((max_level or 0) + 1, MAX_LEVEL)
    generated = sum(1 for row in progress_rows.values() if row.generated)
    opened = sum(1 for row in progress_rows.values() if row.opened)
    browsed = sum(1 for row in progress_rows.values() if row.browsed)
    return {
        "lessons": [
            lesson_to_dict(
                lesson,
                db,
                revisions[lesson.id],
                progress_rows.get(lesson.id),
            )
            for lesson in lessons
        ],
        "next_level": next_level,
        "is_done": (max_level or 0) >= MAX_LEVEL,
        "counts": {
            "total": len(lessons),
            "generated": generated,
            "opened": opened,
            "browsed": browsed,
            "unrecorded": len(lessons) - len(progress_rows),
            "old_content": len(lessons) - generated,
        },
    }


@router.post("/lessons/next")
def create_next_lesson(
    payload: GenerateLessonIn | None = None,
    db: Session = Depends(get_db),
    runtime: Runtime = Depends(get_runtime),
):
    """生成下一课；可选 operation_id 提供稳定幂等身份。"""
    try:
        lesson = generate_next_lesson(
            db,
            operation_id=payload.operation_id if payload else None,
            runtime=runtime,
        )
    except LessonCapReachedError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except LessonLevelConflictError as error:
        raise HTTPException(status_code=409, detail=str(error))
    except (ValueError, TypeError) as error:
        raise HTTPException(status_code=502, detail=str(error))
    return _lesson_detail(lesson, db)


@router.get("/lessons/{level}")
def get_lesson(level: int, db: Session = Depends(get_db)):
    """读指定 level 的课程（含词卡修订、目标与学习状态）。"""
    lesson = db.execute(select(Lesson).where(Lesson.level == level)).scalars().first()
    if lesson is None:
        raise HTTPException(status_code=404, detail="Lesson not found")
    return _lesson_detail(lesson, db)


@router.post("/lessons/{level}/opened")
def mark_lesson_opened(
    level: int,
    db: Session = Depends(get_db),
    runtime: Runtime = Depends(get_runtime),
):
    """记录课程被打开；不是学习完成，也不写学习事件。"""
    try:
        progress = record_lesson_opened(db, level, runtime)
    except LessonNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error))
    return {"learning_progress": progress}


@router.post("/lessons/{level}/viewed")
def mark_lesson_viewed(
    level: int,
    payload: ViewLessonIn,
    db: Session = Depends(get_db),
    runtime: Runtime = Depends(get_runtime),
):
    """显式确认内容已看完；幂等，不等于短测通过。"""
    try:
        progress = record_lesson_viewed(
            db,
            level,
            payload.submission_id,
            {
                "identity": str(payload.revision.identity),
                "version": payload.revision.version,
            },
            runtime,
        )
    except LessonNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error))
    except LessonViewConflictError as error:
        raise HTTPException(status_code=409, detail=str(error))
    return {"committed": True, "learning_progress": progress}
