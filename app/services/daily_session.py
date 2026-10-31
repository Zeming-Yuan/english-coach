"""Bounded daily main queue; priority tags never make a card due."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.card import Card
from app.models.error_card import ErrorCard
from app.models.hard_card import HardCard
from app.models.review import Review
from app.runtime import Runtime
from app.services.card_payload import queue_payload
from app.services.learning import select_current_review


def assemble_daily_queue(due_cards, new_cards, review_limit=20):
    seen = set()
    reviews = []
    for card in due_cards:
        if card["id"] not in seen:
            seen.add(card["id"])
            reviews.append(card)
    selected = reviews[:review_limit]
    review_count = len(selected)
    for card in new_cards:
        if card["id"] not in seen:
            seen.add(card["id"])
            selected.append(card)
    return {
        "queue": selected,
        "review_count": review_count,
        "new_count": len(selected) - review_count,
        "remaining_due": max(0, len(reviews) - review_count),
        "target": len(selected),
    }


def build_daily_queue(db: Session, limit: int, runtime: Runtime, due_limit: int = 20):
    cards = (
        db.execute(select(Card).where(Card.kind == "word").order_by(Card.id))
        .scalars()
        .all()
    )
    states = {}
    for review in db.execute(select(Review)).scalars():
        states.setdefault(review.card_id, []).append(review)
    current = {card_id: select_current_review(rows) for card_id, rows in states.items()}
    now = runtime.clock.now().replace(tzinfo=None)
    due = [card for card in cards if card.id in current and current[card.id].due <= now]
    errors = {}
    for mark in db.execute(select(ErrorCard)).scalars():
        errors[mark.card_id] = max(errors.get(mark.card_id, 0), mark.error_count)
    hard = set(db.execute(select(HardCard.card_id)).scalars())

    def priority(card):
        return (-errors.get(card.id, 0), card.id not in hard)

    due.sort(key=lambda card: (*priority(card), current[card.id].due, card.id))
    new = sorted(
        [card for card in cards if card.id not in current],
        key=lambda card: (*priority(card), card.id),
    )[: max(0, limit)]
    return assemble_daily_queue(
        [queue_payload(card) for card in due],
        [queue_payload(card) for card in new],
        max(0, min(20, due_limit)),
    )
