from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.card import Card
from app.models.error_card import ErrorCard
from app.models.hard_card import HardCard
from app.models.review import Review
from app.models.review_baseline import ReviewBaseline
from app.models.review_event import ReviewEvent
from app.runtime import Runtime, get_runtime
from app.services.card_payload import queue_payload
from app.services.daily_session import build_daily_queue
from app.services.statistics import (
    adaptive_new_limit,
    history_days,
    learning_day,
    metric,
    review_pass_rate,
    summary_for_day,
)

router = APIRouter()


@router.get("/today")
def get_today(
    new_limit: int = 10,
    due_limit: int = 20,
    db: Session = Depends(get_db),
    runtime: Runtime = Depends(get_runtime),
):
    # 决策（2026-09-02）：句子卡退出复习队列，只留单词卡。
    # 依据：词库 <200 词时 AI 例句含大量未学词（违反 i+1），整句提取负载淹没问题词；
    # 语境复现职责由故事页承担（自定节奏、无评分压力）。
    # 句子卡数据保留在 cards 表，词库过 200 词后可评估恢复。
    # 新词建议只看近 7 个学习日、同卡同日首条可排期事件；每日完成目标不参与。
    today = learning_day(runtime.clock.now(), runtime.learning_timezone)
    adaptive_limit, error_rate, sample_count = adaptive_new_limit(
        _event_rows(db), today, base=new_limit
    )
    new_limit = adaptive_limit
    stmt = (
        select(Card)
        .outerjoin(Review, Review.card_id == Card.id)
        .where(Review.id.is_(None), Card.kind == "word")
        .order_by(Card.id)
        .limit(new_limit)
    )
    new_cards = db.execute(stmt).scalars().all()
    new_cards_dict = [queue_payload(card) for card in new_cards]
    stmt = (
        select(Card)
        .join(Review, Review.card_id == Card.id)
        .where(
            Review.due <= datetime.now(UTC).replace(tzinfo=None),
            Card.kind == "word",
        )
        .order_by(Review.due)
        .limit(due_limit)
    )
    due_cards = db.execute(stmt).scalars().all()
    due_cards_dict = [queue_payload(card) for card in due_cards]
    # 错词优先：有错词记录的卡排到队列最前面（错误增强效应）
    error_first = (
        db.execute(
            select(Card)
            .join(ErrorCard, ErrorCard.card_id == Card.id)
            .where(Card.kind == "word")
            .order_by(ErrorCard.error_count.desc())
            .limit(10)
        )
        .scalars()
        .all()
    )
    error_ids = {c.id for c in error_first}
    if error_ids:
        new_cards_dict = [c for c in new_cards_dict if c["id"] not in error_ids]
        due_cards_dict = [c for c in due_cards_dict if c["id"] not in error_ids]
    # 困难词优先（自主增强）：并入 error_cards 列表尾部
    hard_first = (
        db.execute(
            select(Card)
            .join(HardCard, HardCard.card_id == Card.id)
            .where(Card.kind == "word", Card.id.not_in(error_ids))
            if error_ids
            else select(Card)
            .join(HardCard, HardCard.card_id == Card.id)
            .where(Card.kind == "word")
        )
        .scalars()
        .all()
    )
    hard_ids = {c.id for c in hard_first}
    if hard_ids:
        new_cards_dict = [c for c in new_cards_dict if c["id"] not in hard_ids]
        due_cards_dict = [c for c in due_cards_dict if c["id"] not in hard_ids]
    return {
        **build_daily_queue(db, adaptive_limit, runtime, due_limit),
        "error_cards": [queue_payload(c) for c in list(error_first) + list(hard_first)],
        "new_cards": new_cards_dict,
        "due_cards": due_cards_dict,
        "recommended_goal": adaptive_limit,  # 新词建议（只看可排期首答）
        "error_rate": round(error_rate * 100) if error_rate is not None else None,
        "sample_count": sample_count,
    }


@router.get("/stats/weekly")
def get_weekly_accuracy(
    db: Session = Depends(get_db), runtime: Runtime = Depends(get_runtime)
):
    """近 8 周复习通过率；accuracy 是 review_pass_rate 的兼容别名。"""
    today = learning_day(runtime.clock.now(), runtime.learning_timezone)
    today_date = datetime.fromisoformat(today).date()
    events = [
        event
        for event in _event_rows(db)
        if event["source"] != "legacy"
        and event["scheduled"]
        and not event["skipped"]
        and event["fsrs_rating"] is not None
    ]

    def percent(rows):
        if not rows:
            return None
        return round(
            sum(1 for row in rows if row["fsrs_rating"] >= 3) / len(rows) * 100
        )

    monday = today_date - timedelta(days=today_date.weekday())
    weeks = []
    for i in range(7, -1, -1):
        start = monday - timedelta(days=7 * i)
        end = start + timedelta(days=7)
        rows = [
            event
            for event in events
            if start.isoformat() <= event["learning_day"] < end.isoformat()
        ]
        weeks.append(
            {
                "start": start.isoformat(),
                "total": len(rows),
                "accuracy": percent(rows),
            }
        )

    recent_start = (today_date - timedelta(days=6)).isoformat()
    recent = [
        event for event in events if recent_start <= event["learning_day"] <= today
    ]
    return {
        "weeks": weeks,
        "this_week": percent(recent),
        "accuracy_kind": "review_pass_rate",
    }


@router.get("/errors")
def get_errors(db: Session = Depends(get_db)):
    """错词本：记录在 error_cards 里的卡，按错误次数倒序。"""
    rows = db.execute(
        select(ErrorCard, Card)
        .join(Card, Card.id == ErrorCard.card_id)
        .order_by(ErrorCard.error_count.desc(), ErrorCard.last_error_at)
    ).all()
    result = []
    for r, c in rows:
        result.append(
            {
                "card_id": r.card_id,
                "error_count": r.error_count,
                "word": c.word,
                "meaning": c.meaning,
                "last_error_at": r.last_error_at.isoformat()
                if r.last_error_at
                else None,
            }
        )
    return {"errors": result}


def _event_rows(db: Session) -> list[dict]:
    """统计读取的事件形状：只取聚合需要的字段。"""
    rows = db.execute(
        select(
            ReviewEvent.id,
            ReviewEvent.card_id,
            ReviewEvent.learning_day,
            ReviewEvent.skipped,
            ReviewEvent.scheduled,
            ReviewEvent.occurred_at,
            ReviewEvent.source,
            ReviewEvent.kind,
            ReviewEvent.assistance,
            ReviewEvent.correct,
            ReviewEvent.fsrs_rating,
            ReviewEvent.self_rating,
        )
    ).all()
    return [
        {
            "event_id": row.id,
            "card_id": row.card_id,
            "learning_day": row.learning_day,
            "skipped": row.skipped,
            "scheduled": row.scheduled,
            "occurred_at": row.occurred_at,
            "source": row.source,
            "kind": row.kind,
            "assistance": list(row.assistance or []),
            "correct": row.correct,
            "fsrs_rating": row.fsrs_rating,
            "self_rating": row.self_rating,
        }
        for row in rows
    ]


@router.get("/stats")
def get_stats(db: Session = Depends(get_db), runtime: Runtime = Depends(get_runtime)):
    """学习统计：今日完成词、练习次数、跳过数、连续天数与旧历史提示。"""
    today = learning_day(runtime.clock.now(), runtime.learning_timezone)
    events = _event_rows(db)
    summary = summary_for_day(events, today)
    total_cards = db.execute(select(func.count(Card.id))).scalar_one()
    graduated = db.execute(
        select(func.count(Review.id))
        .join(Card, Review.card_id == Card.id)
        .where(
            Card.kind == "word",
            or_(Review.state == 2, Review.review_count >= 3),
        )
    ).scalar_one()
    history_incomplete = (
        db.execute(select(ReviewBaseline.id).limit(1)).first() is not None
    )
    return {
        **summary,
        "total_cards": total_cards,
        "graduated": graduated,
        "history_incomplete": history_incomplete,
        "learning_timezone": runtime.learning_timezone,
        "metrics": {
            category: metric(events, category)
            for category in ("retrieval", "assisted", "recognition", "self_report")
        },
        "review_pass_rate": review_pass_rate(events),
    }


@router.get("/stats/history")
def get_stats_history(
    days: int = 90,
    db: Session = Depends(get_db),
    runtime: Runtime = Depends(get_runtime),
):
    """学习统计历史：按事件学习日聚合，缺失日期零填充。"""
    today = learning_day(runtime.clock.now(), runtime.learning_timezone)
    start = (datetime.fromisoformat(today).date() - timedelta(days=days)).isoformat()
    events = [
        event for event in _event_rows(db) if start <= event["learning_day"] <= today
    ]
    return {"days": history_days(events, start, today)}


@router.get("/recommended")
def get_recommended(limit: int = 5, db: Session = Depends(get_db)):
    """每日推荐词：基于遗忘曲线，推荐即将到期但未复习的词。

    策略：
    1. 优先推荐 due 在今天到明天之间到期的词（即将遗忘）
    2. 其次推荐 review_count >= 2 但最近 3 天没复习的词（巩固期）
    3. 排除已经在错误词/困难词列表里的（已有专门复习入口）
    """
    now = datetime.now(UTC).replace(tzinfo=None)
    tomorrow = now + timedelta(days=1)
    three_days_ago = now - timedelta(days=3)

    # 已学过的词（有复习记录）
    reviewed_cards = db.execute(
        select(Card, Review)
        .join(Review, Review.card_id == Card.id)
        .where(Card.kind == "word")
    ).all()

    # 错误词/困难词 ID（已有专门入口，不重复推荐）
    error_ids = {e.card_id for e in db.execute(select(ErrorCard)).scalars().all()}
    hard_ids = {h.card_id for h in db.execute(select(HardCard)).scalars().all()}
    exclude_ids = error_ids | hard_ids

    candidates = []
    for card, review in reviewed_cards:
        if card.id in exclude_ids:
            continue
        # 即将到期（今天到明天）
        if review.due and now <= review.due <= tomorrow:
            candidates.append((card, review, 1))  # 优先级 1
        # 巩固期：复习过 2+ 次但最近 3 天没复习
        elif review.review_count >= 2 and (
            review.last_review is None or review.last_review < three_days_ago
        ):
            candidates.append((card, review, 2))  # 优先级 2

    # 按优先级排序，取前 limit 个
    candidates.sort(key=lambda x: x[2])
    selected = candidates[:limit]

    return {
        "recommended": [queue_payload(card) for card, _, _ in selected],
        "total_candidates": len(candidates),
    }
