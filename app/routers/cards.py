"""词卡路由：生成词卡 + 单词本列表。"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.card import Card
from app.models.review import Review
from app.services.card_generator import generate_cards

router = APIRouter()


class GenerateCardsIn(BaseModel):
    """生成词卡请求体。"""

    words: list[str] = Field(min_length=1, max_length=20)


def card_to_dict(card: Card, db: Session) -> dict:
    """Card → 字典（含复习状态）。"""
    review = (
        db.execute(
            select(Review)
            .where(Review.card_id == card.id)
            .order_by(Review.id.desc())
        )
        .scalars()
        .first()
    )
    return {
        "id": card.id,
        "word": card.word,
        "kind": card.kind,
        "phonetic": card.phonetic,
        "meaning": card.meaning,
        "example": card.example,
        "example_cn": card.example_cn,
        "explanation": card.explanation,
        "contexts": card.contexts,
        "review_count": review.review_count if review else 0,
        "graduated": review.state == 3 if review else False,
    }


@router.post("/cards/generate")
def generate(req: GenerateCardsIn, db: Session = Depends(get_db)):
    """AI 批量生成词卡（已存在的词跳过）。"""
    try:
        cards = generate_cards(req.words, db)
    except ValueError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {
        "generated": len(cards),
        "skipped": len(req.words) - len(cards),
        "cards": [card_to_dict(c, db) for c in cards],
    }


@router.get("/cards")
def list_cards(db: Session = Depends(get_db)):
    """单词本：全库卡片，按创建时间倒序。"""
    cards = (
        db.execute(select(Card).order_by(Card.created_at.desc(), Card.id.desc()))
        .scalars()
        .all()
    )
    return {"cards": [card_to_dict(c, db) for c in cards]}
