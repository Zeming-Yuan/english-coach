"""课程路由：查进度 / 生成下一课 / 读课程详情。"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.card import Card
from app.models.lesson import Lesson
from app.services.lesson_generator import generate_lesson

router = APIRouter()

MAX_LEVEL = 20


def lesson_to_dict(lesson: Lesson, db: Session) -> dict:
    """Lesson → 字典。"""
    return {
        "id": lesson.id,
        "level": lesson.level,
        "title": lesson.title,
        "content": lesson.content,
        "created_at": lesson.created_at,
    }


@router.get("/lessons")
def list_lessons(db: Session = Depends(get_db)):
    """课程列表 + 当前进度（下一课 level）。"""
    lessons = db.execute(select(Lesson).order_by(Lesson.level)).scalars().all()
    max_level = db.execute(select(func.max(Lesson.level))).scalar_one()
    next_level = min((max_level or 0) + 1, MAX_LEVEL)
    return {
        "lessons": [lesson_to_dict(l, db) for l in lessons],
        "next_level": next_level,
        "is_done": (max_level or 0) >= MAX_LEVEL,
    }


@router.post("/lessons/next")
def create_next_lesson(db: Session = Depends(get_db)):
    """生成下一课（自动推断 level）。"""
    max_level = db.execute(select(func.max(Lesson.level))).scalar_one()
    level = min((max_level or 0) + 1, MAX_LEVEL)
    if (max_level or 0) >= MAX_LEVEL:
        raise HTTPException(status_code=400, detail="全部课程已学完")
    try:
        lesson = generate_lesson(db, level)
    except ValueError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return lesson_to_dict(lesson, db)


@router.get("/lessons/{level}")
def get_lesson(level: int, db: Session = Depends(get_db)):
    """读指定 level 的课程（含词卡 id 关联）。"""
    lesson = db.execute(select(Lesson).where(Lesson.level == level)).scalars().first()
    if lesson is None:
        raise HTTPException(status_code=404, detail="Lesson not found")

    result = lesson_to_dict(lesson, db)
    # 附带词卡 id（让前端能评分）
    words = lesson.content.get("words", [])
    card_ids = {}
    for w in words:
        card = (
            db.execute(select(Card).where(Card.word == w["word"], Card.kind == "word"))
            .scalars()
            .first()
        )
        if card:
            card_ids[w["word"]] = card.id
    result["card_ids"] = card_ids
    return result
