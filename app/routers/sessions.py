"""Read-only views of committed daily learning events."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import literal_column, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.card import Card
from app.models.review_event import ReviewEvent
from app.services.daily_session import build_reinforcement
from app.services.learning import _event_payload

router = APIRouter()


def session_events(db, session_id):
    rows = (
        db.execute(
            select(ReviewEvent)
            .where(ReviewEvent.session_id == str(session_id))
            .order_by(ReviewEvent.occurred_at, literal_column("review_events.rowid"))
        )
        .scalars()
        .all()
    )
    if not rows:
        raise HTTPException(
            status_code=404, detail="本轮学习记录不存在，请返回重新加载"
        )
    return [_event_payload(row) for row in rows]


@router.get("/sessions/{session_id}/reinforcement")
def reinforcement(session_id: UUID, db: Session = Depends(get_db)):
    events = session_events(db, session_id)
    answered = {
        event["card_id"] for event in events if event["stage"] == "reinforcement"
    }
    questions = []
    for item in build_reinforcement(events):
        if item["card_id"] in answered:
            continue
        card = db.get(Card, item["card_id"])
        if card and card.kind == "word" and card.meaning and card.word:
            questions.append(
                {"card_id": card.id, "word": card.word, "meaning": card.meaning}
            )
    return {"questions": questions}


@router.get("/sessions/{session_id}/summary")
def summary(session_id: UUID, db: Session = Depends(get_db)):
    from app.models.review import Review
    from app.services.daily_session import summarize_session

    events = session_events(db, session_id)
    data = summarize_session(events)
    ids = {event["card_id"] for event in events}
    cards = {
        card.id: card
        for card in db.execute(select(Card).where(Card.id.in_(ids))).scalars()
    }
    due = {
        review.card_id: review.due.isoformat()
        for review in db.execute(
            select(Review).where(Review.card_id.in_(ids))
        ).scalars()
    }
    data["weak_words"] = [
        {"card_id": cid, "word": cards[cid].word, "next_due": due.get(cid)}
        for cid in data.pop("weak_card_ids")
        if cid in cards
    ]
    data["next_due"] = min(due.values(), default=None)
    data["session_id"] = str(session_id)
    return data
