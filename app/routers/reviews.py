# 复习提交路由

import threading
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.card import Card
from app.models.review import Review
from app.services.error_tracking import record_error
from app.services.graduation import (
    graduate_to_sentence,
    is_graduated,
    upgrade_sentence_card,
)
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
    review.rating = req.rating  # 记录评分（复习历史展示）
    # 5. 毕业检查：词卡毕业则先建例句兜底句卡（同步、毫秒级）
    should_upgrade = False
    graduated_sentence = None
    if card.kind == "word" and is_graduated(review):
        graduated_sentence = graduate_to_sentence(card, db)
        should_upgrade = True
    # 6. 错词追踪：rating<=2 加权，>=3 减权（错误增强效应）
    record_error(db, req.card_id, is_correct=req.rating >= 3)
    db.commit()
    # 7. AI 复杂句生成放后台线程：复习提交秒回，学习流程不被 AI 卡住。
    #    只有词卡毕业才启动；幂等（已有 AI 句卡则跳过，见 upgrade_sentence_card）。
    if should_upgrade:
        threading.Thread(target=upgrade_sentence_card, args=(card.id,), daemon=True).start()
    result = {"card_id": req.card_id, "next_due": new_card.due}
    if graduated_sentence:
        result["graduated"] = True
        result["sentence_card_id"] = graduated_sentence.id
    return result
