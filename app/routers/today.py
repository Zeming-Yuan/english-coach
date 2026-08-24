from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.card import Card
from app.models.review import Review

router = APIRouter()


def card_to_dict(card: Card) -> dict:
    """将 Card ORM 对象转换为字典，便于 JSON 响应。"""
    return {
        "id": card.id,
        "word": card.word,
        "phonetic": card.phonetic,
        "meaning": card.meaning,
        "example": card.example,
        "example_cn": card.example_cn,
        "explanation": card.explanation,
        "contexts": card.contexts,
        "kind": card.kind,
    }


@router.get("/today")
def get_today(new_limit: int = 10, due_limit: int = 20, db: Session = Depends(get_db)):
    stmt = (
        select(Card)
        .outerjoin(Review, Review.card_id == Card.id)
        .where(Review.id.is_(None))
        .order_by(Card.id)
        .limit(new_limit)
    )
    new_cards = db.execute(stmt).scalars().all()
    new_cards_dict = [card_to_dict(card) for card in new_cards]
    stmt = (
        select(Card)
        .join(Review, Review.card_id == Card.id)
        .where(Review.due <= datetime.now(timezone.utc).replace(tzinfo=timezone.utc))
        .order_by(Review.due)
        .limit(due_limit)
    )
    due_cards = db.execute(stmt).scalars().all()
    due_cards_dict = [card_to_dict(card) for card in due_cards]
    return {"new_cards": new_cards_dict, "due_cards": due_cards_dict}


@router.get("/stats")
def get_stats(db: Session = Depends(get_db)):
    """学习统计：今日复习次数、词卡总数、连续学习天数。"""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    reviewed_today = db.execute(
        select(func.count(Review.id)).where(Review.last_review >= today_start)
    ).scalar_one()
    total_cards = db.execute(select(func.count(Card.id))).scalar_one()
    graduated = db.execute(
        select(func.count(Review.id)).where(Review.state == 3)
    ).scalar_one()
    return {
        "reviewed_today": reviewed_today,
        "total_cards": total_cards,
        "graduated": graduated,
        "streak": _calc_streak(db, now, today_start),
    }


def _calc_streak(db: Session, now: datetime, today_start: datetime) -> int:
    """连续学习天数：从今天（或昨天）往回数有复习记录的连续天数。

    多邻国规则：
    - 今天学过 → streak 从今天开始算
    - 今天没学但昨天学过 → streak 保留（今天还没断）
    - 今天昨天都没学 → streak 归零
    """
    # 取所有复习过的（日期去重，日期 = last_review 的日期）
    rows = (
        db.execute(select(Review.last_review).where(Review.last_review.is_not(None)))
        .scalars()
        .all()
    )
    days = {r.date() for r in rows}
    if not days:
        return 0

    # 起点：今天或昨天
    today = today_start.date()
    if today in days:
        cursor = today
    elif (today - timedelta(days=1)) in days:
        cursor = today - timedelta(days=1)
    else:
        return 0

    streak = 0
    while cursor in days:
        streak += 1
        cursor -= timedelta(days=1)
    return streak
