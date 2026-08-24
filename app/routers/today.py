from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.card import Card
from app.models.error_card import ErrorCard
from app.models.hard_card import HardCard
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
    # 难度自适应：近 7 天正确率自动调新词量（desired-retention 思想）
    new_limit = _adaptive_new_limit(db, new_limit)
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
    # 错词优先：有错词记录的卡排到队列最前面（错误增强效应）
    error_first = db.execute(
        select(Card)
        .join(ErrorCard, ErrorCard.card_id == Card.id)
        .order_by(ErrorCard.error_count.desc())
        .limit(10)
    ).scalars().all()
    error_ids = {c.id for c in error_first}
    if error_ids:
        new_cards_dict = [c for c in new_cards_dict if c["id"] not in error_ids]
        due_cards_dict = [c for c in due_cards_dict if c["id"] not in error_ids]
    # 困难词优先（自主增强）：并入 error_cards 列表尾部
    hard_first = db.execute(
        select(Card)
        .join(HardCard, HardCard.card_id == Card.id)
        .where(Card.id.not_in(error_ids)) if error_ids else
        select(Card).join(HardCard, HardCard.card_id == Card.id)
    ).scalars().all()
    hard_ids = {c.id for c in hard_first}
    if hard_ids:
        new_cards_dict = [c for c in new_cards_dict if c["id"] not in hard_ids]
        due_cards_dict = [c for c in due_cards_dict if c["id"] not in hard_ids]
    return {
        "error_cards": [card_to_dict(c) for c in error_first + hard_first],
        "new_cards": new_cards_dict,
        "due_cards": due_cards_dict,
    }


@router.get("/stats/weekly")
def get_weekly_accuracy(db: Session = Depends(get_db)):
    """近 8 周复习正确率：周维度趋势 + 本周正确率。

    正确率口径：rating>=3 视为对，rating 为 null 的旧记录按 state 兜底
    （state==2 视为错，否则为对）。无数据周返回 None。
    """
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    reviews = db.execute(
        select(Review).where(Review.last_review >= now - timedelta(days=56))
    ).scalars().all()

    def is_ok(r):
        if r.rating is not None:
            return r.rating >= 3
        return r.state != 2  # 旧数据兜底

    weeks = []
    for i in range(7, -1, -1):
        week_start = (now - timedelta(days=(now.weekday() + 7 * i))).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        week_end = week_start + timedelta(days=7)
        week_reviews = [
            r
            for r in reviews
            if r.last_review is not None
            and week_start <= r.last_review < week_end
        ]
        if week_reviews:
            ok = sum(1 for r in week_reviews if is_ok(r))
            weeks.append(
                {
                    "start": week_start.strftime("%Y-%m-%d"),
                    "total": len(week_reviews),
                    "accuracy": round(ok / len(week_reviews) * 100),
                }
            )
        else:
            weeks.append({"start": week_start.strftime("%Y-%m-%d"), "total": 0, "accuracy": None})

    # 本周正确率（前 7 天）
    week_ago = now - timedelta(days=7)
    recent = [r for r in reviews if r.last_review is not None and r.last_review >= week_ago]
    this_week_accuracy = (
        round(sum(1 for r in recent if is_ok(r)) / len(recent) * 100) if recent else None
    )

    return {"weeks": weeks, "this_week": this_week_accuracy}


def _adaptive_new_limit(db: Session, base: int) -> int:
    """近 7 天复习正确率 → 新词量调节。

    规则（desired-retention 思想）：
    - 错误率 >30%（难）→ 新词量降到 5
    - 错误率 <15%（简单）→ 新词量升到 15
    - 中间保持 base（10）
    注：Review.state 存 FSRS 状态且未存评分，用 state==2（Relearning，
    FSRS 中答错后进入的重学状态）近似"近期答错"。
    """
    from datetime import timedelta as _td

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    week_ago = now - _td(days=7)
    reviews = db.execute(
        select(Review).where(Review.last_review >= week_ago)
    ).scalars().all()
    if not reviews:
        return base  # 数据不足，默认
    wrong = sum(1 for r in reviews if r.state == 2)
    error_rate = wrong / len(reviews)
    if error_rate > 0.3:
        return 5
    if error_rate < 0.15:
        return 15
    return base


@router.get("/errors")
def get_errors(db: Session = Depends(get_db)):
    """错词本：记录在 error_cards 里的卡，按错误次数倒序。"""
    rows = db.execute(
        select(ErrorCard)
        .join(Card, Card.id == ErrorCard.card_id)
        .order_by(ErrorCard.error_count.desc(), ErrorCard.last_error_at)
    ).scalars().all()
    return {
        "errors": [
            {
                "card_id": r.card_id,
                "error_count": r.error_count,
                "word": db.get(Card, r.card_id).word,
                "meaning": db.get(Card, r.card_id).meaning,
                "last_error_at": r.last_error_at.isoformat() if r.last_error_at else None,
            }
            for r in rows
        ]
    }


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


@router.get("/stats/history")
def get_stats_history(days: int = 90, db: Session = Depends(get_db)):
    """学习统计历史：最近 N 天每日复习数 + 新词数。"""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    start = now - timedelta(days=days)

    # 每日复习数（按 last_review 日期分组）
    rows = db.execute(
        select(
            func.date(Review.last_review).label("date"),
            func.count(Review.id).label("count"),
        )
        .where(Review.last_review >= start)
        .group_by(func.date(Review.last_review))
        .order_by(func.date(Review.last_review))
    ).all()
    review_map = {r.date: r.count for r in rows}

    # 每日新词数（按 Review 创建时间，即首次复习）
    new_rows = db.execute(
        select(
            func.date(Review.last_review).label("date"),
            func.count(Review.id).label("count"),
        )
        .where(Review.last_review >= start, Review.review_count == 1)
        .group_by(func.date(Review.last_review))
        .order_by(func.date(Review.last_review))
    ).all()
    new_map = {r.date: r.count for r in new_rows}

    # 构造每日数据（含 0 的天也返回）
    result = []
    for i in range(days + 1):
        d = (now - timedelta(days=days - i)).strftime("%Y-%m-%d")
        result.append(
            {
                "date": d,
                "reviews": review_map.get(d, 0),
                "new_cards": new_map.get(d, 0),
            }
        )

    return {"days": result}


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
