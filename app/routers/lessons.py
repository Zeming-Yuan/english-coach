"""课程路由：查进度 / 生成下一课 / 读课程详情。"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.card import Card
from app.models.lesson import Lesson
from app.services.contacts import visible_card_ids
from app.services.content_revisions import content_revision_map, get_content_revision
from app.services.lesson_generator import generate_lesson

router = APIRouter()

MAX_LEVEL = 20


def lesson_to_dict(lesson: Lesson, db: Session, revision: dict | None = None) -> dict:
    """Lesson → 字典（含当前内容修订）。"""
    return {
        "id": lesson.id,
        "level": lesson.level,
        "title": lesson.title,
        "content": lesson.content,
        "created_at": lesson.created_at,
        "content_revision": revision
        or get_content_revision(db, "lesson", lesson.id),
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
    return {
        **lesson_to_dict(lesson, db),
        "card_ids": {word["word"]: word["id"] for word in words},
        "words": words,
        "dialogue": dialogue,
        # 词表整行打开即显示；对话内再次出现不制造重复身份。
        "visible_card_ids": [word["id"] for word in words],
    }


@router.get("/lessons")
def list_lessons(db: Session = Depends(get_db)):
    """课程列表 + 当前进度（下一课 level）。"""
    lessons = db.execute(select(Lesson).order_by(Lesson.level)).scalars().all()
    revisions = content_revision_map(db, "lesson", [lesson.id for lesson in lessons])
    max_level = db.execute(select(func.max(Lesson.level))).scalar_one()
    next_level = min((max_level or 0) + 1, MAX_LEVEL)
    return {
        "lessons": [
            lesson_to_dict(lesson, db, revisions[lesson.id]) for lesson in lessons
        ],
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
    return _lesson_detail(lesson, db)


@router.get("/lessons/{level}")
def get_lesson(level: int, db: Session = Depends(get_db)):
    """读指定 level 的课程（含词卡 id 关联）。"""
    lesson = db.execute(select(Lesson).where(Lesson.level == level)).scalars().first()
    if lesson is None:
        raise HTTPException(status_code=404, detail="Lesson not found")
    return _lesson_detail(lesson, db)
