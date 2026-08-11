# 复习提交路由

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.card import Card
from app.models.review import Review
from app.services.scheduler import build_fsrs_card, schedule

router = APIRouter()


class ReviewRequest(BaseModel):
    """复习提交请求体——rating 只允许 1-4，非法自动 422"""

    card_id: int
    rating: Literal[1, 2, 3, 4]


@router.post("/reviews")
def submit_review(req: ReviewRequest, db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)
    # 1. 查卡
    card = db.execute(select(Card).where(Card.id == req.card_id)).scalars().first()
    if card is None:
        raise HTTPException(status_code=404, detail="Card not found")
    # 2. 取最新 review
    review = (
        db.execute(
            select(Review)
            .where(Review.card_id == req.card_id)
            .order_by(Review.id.desc())
        )
        .scalars()
        .first()
    )
    # 3. 构建 fsrs.Card
    fsrs_card = build_fsrs_card(review)
    new_card = schedule(fsrs_card, req.rating, now)
    # 4. 写回数据库

    if review is None:
        review = Review(card_id=req.card_id, review_count=1)
        db.add(review)
    else:
        review.review_count += 1

    review.state = new_card.state.value
    review.step = new_card.step
    review.due = new_card.due
    review.stability = new_card.stability  # type: ignore
    review.difficulty = new_card.difficulty  # type: ignore
    review.elapsed_days = (
        (now - review.last_review.replace(tzinfo=timezone.utc)).days
        if review.last_review
        else 0
    )
    review.last_review = now
    db.commit()
    return {"card_id": req.card_id, "next_due": new_card.due}
