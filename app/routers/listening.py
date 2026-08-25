"""听写练习路由：播发音 → 4 选 1。"""

import random
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.card import Card
from app.models.review import Review
from app.services.error_tracking import record_error

router = APIRouter()


@router.get("/listening")
def get_listening(limit: int = 5, db: Session = Depends(get_db)):
    """从今日队列（新词 + 到期卡）抽词，生成听写题。"""
    # 1. 取今日队列（复用 today 的逻辑）
    now = datetime.now(timezone.utc)
    new_cards = (
        db.execute(
            select(Card)
            .outerjoin(Review, Review.card_id == Card.id)
            .where(Review.id.is_(None), Card.kind == "word")
            .order_by(Card.id)
            .limit(limit)
        )
        .scalars()
        .all()
    )
    due_cards = (
        db.execute(
            select(Card)
            .join(Review, Review.card_id == Card.id)
            .where(Review.due <= now, Card.kind == "word")
            .order_by(Review.due)
            .limit(limit)
        )
        .scalars()
        .all()
    )

    # 合并去重，取最多 limit 个
    seen = set()
    pool = []
    for c in list(new_cards) + list(due_cards):
        if c.id not in seen:
            seen.add(c.id)
            pool.append(c)

    # 今日队列为空时，从全库随机取词
    if not pool:
        all_word_cards = (
            db.execute(select(Card).where(Card.kind == "word")).scalars().all()
        )
        pool = random.sample(all_word_cards, min(limit, len(all_word_cards)))
        seen = {c.id for c in pool}

    selected = pool[:limit]

    if not selected:
        return {"questions": []}

    # 2. 全库词卡（用于干扰项，排除已选中的）
    all_words = db.execute(select(Card).where(Card.kind == "word")).scalars().all()
    all_word_texts = [c.word for c in all_words if c.id not in seen]

    # 3. 生成题目：每题 4 选项（1 正确 + 最多 3 干扰）
    questions = []
    for card in selected:
        distractors = random.sample(all_word_texts, min(3, len(all_word_texts)))
        options = [card.word] + distractors
        random.shuffle(options)
        correct_index = options.index(card.word)
        questions.append(
            {
                "card_id": card.id,
                "word": card.word,
                "meaning": card.meaning,
                "options": options,
                "correct_index": correct_index,
            }
        )

    return {"questions": questions}


class ListeningScoreIn(BaseModel):
    """听写评分请求体。"""

    card_id: int
    selected_index: int
    correct_index: int
    rating: int = Field(default=3, ge=1, le=4)  # FSRS 评分 1-4


@router.post("/listening/score")
def score_listening(payload: ListeningScoreIn, db: Session = Depends(get_db)):
    """听写评分：判断对错 + 提交 FSRS。"""
    card = db.get(Card, payload.card_id)
    if card is None:
        raise HTTPException(status_code=404, detail="Card not found")

    correct = payload.selected_index == payload.correct_index

    # FSRS 评分（复用 reviews 端点的逻辑）
    from app.services.scheduler import build_fsrs_card, schedule

    now = datetime.now(timezone.utc)
    review = (
        db.execute(
            select(Review)
            .where(Review.card_id == payload.card_id)
            .order_by(Review.id.desc())
        )
        .scalars()
        .first()
    )

    fsrs_card = build_fsrs_card(review)
    new_card = schedule(fsrs_card, payload.rating, now)

    if review:
        review.state = new_card.state.value
        review.step = new_card.step
        review.due = new_card.due
        review.stability = new_card.stability  # type: ignore[assignment]
        review.difficulty = new_card.difficulty  # type: ignore[assignment]
        review.elapsed_days = (
            (now - review.last_review.replace(tzinfo=timezone.utc)).days
            if review.last_review
            else 0
        )
        review.last_review = now
        review.review_count += 1
        review.rating = payload.rating  # 记录评分（复习历史展示）
    else:
        review = Review(
            card_id=payload.card_id,
            state=new_card.state.value,
            step=new_card.step,
            due=new_card.due,
            stability=new_card.stability,
            difficulty=new_card.difficulty,
            elapsed_days=0,
            last_review=now,
            review_count=1,
            rating=payload.rating,
        )
        db.add(review)

    # 错词追踪：答错加权，答对减权
    record_error(db, payload.card_id, is_correct=correct)
    db.commit()

    return {
        "correct": correct,
        "correct_word": card.word,
        "graduated": review.state == 2,
        "next_due": review.due.isoformat(),
    }
