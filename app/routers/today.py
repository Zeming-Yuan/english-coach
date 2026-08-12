from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select
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
