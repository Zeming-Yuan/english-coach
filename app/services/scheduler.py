# FSRS 调度服务层
from datetime import datetime, timezone

from fsrs import Card, Rating, Scheduler, State

from app.models import Review

scheduler = Scheduler()


def build_fsrs_card(review: Review | None) -> Card:
    if review is None:
        # 无记录（新词）：Card() 默认即可
        return Card()
    # 有记录：数据库字段 → fsrs.Card
    return Card(
        state=State(review.state),
        step=review.step,
        stability=review.stability,
        difficulty=review.difficulty,
        due=review.due.replace(tzinfo=timezone.utc),
        last_review=(
            review.last_review.replace(tzinfo=timezone.utc)
            if review.last_review
            else None
        ),
    )


def schedule(card: Card, rating: int, now: datetime) -> Card:
    """调度：review_card 计算，返回新状态卡"""
    new_card, _ = scheduler.review_card(card, Rating(rating), review_datetime=now)
    return new_card
