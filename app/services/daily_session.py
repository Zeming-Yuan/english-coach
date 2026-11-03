"""Bounded daily main queue; priority tags never make a card due."""

from sqlalchemy import literal_column, select
from sqlalchemy.orm import Session

from app.models.card import Card
from app.models.error_card import ErrorCard
from app.models.hard_card import HardCard
from app.models.review import Review
from app.models.review_baseline import ReviewBaseline
from app.models.review_event import ReviewEvent
from app.runtime import Runtime
from app.services.card_payload import queue_payload
from app.services.content_revisions import content_revision_map
from app.services.learning import select_current_review
from app.services.statistics import learning_day
from app.services.time_budget import budget_plan


def build_daily_queue(
    db: Session, limit: int, runtime: Runtime, due_limit: int = 20, minutes: int = 8
):
    today = learning_day(runtime.clock.now(), runtime.learning_timezone)
    first = {}
    for event in db.scalars(
        select(ReviewEvent)
        .join(Card, Card.id == ReviewEvent.card_id)
        .where(ReviewEvent.scheduled.is_(True), Card.kind == "word")
        .order_by(ReviewEvent.occurred_at, literal_column("review_events.rowid"))
    ):
        first.setdefault(event.card_id, event)
    baseline_ids = set(db.scalars(select(ReviewBaseline.card_id)))
    used = sum(
        event.learning_day == today
        and card_id not in baseline_ids
        and event.before is not None
        and event.before.get("last_review") is None
        and event.before.get("stability") is None
        for card_id, event in first.items()
    )
    new_remaining = max(0, limit - used)
    cards = (
        db.execute(select(Card).where(Card.kind == "word").order_by(Card.id))
        .scalars()
        .all()
    )
    states = {}
    for review in db.execute(select(Review)).scalars():
        states.setdefault(review.card_id, []).append(review)
    current = {
        card_id: review
        for card_id, rows in states.items()
        if (review := select_current_review(rows)) is not None
    }
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
    )[:new_remaining]
    revisions = content_revision_map(db, "card", [c.id for c in [*due, *new]])
    result = budget_plan(
        [queue_payload(card, revisions[card.id]) for card in due],
        [queue_payload(card, revisions[card.id]) for card in new],
        minutes,
        new_remaining,
        review_limit=due_limit,
    )
    result["new_remaining"] = new_remaining
    return result


def build_reinforcement(events, max_items=3):
    """Select the first three distinct weak main cards, in saved-event order."""
    selected = {}
    for event in events:
        weak = (
            event["skipped"]
            or event.get("correct") is False
            or event.get("fsrs_rating") in (1, 2)
        )
        if event["stage"] == "main" and weak:
            selected.setdefault(event["card_id"], {"card_id": event["card_id"]})
    return list(selected.values())[: max(0, min(max_items, 3))]


def summarize_session(events):
    """Describe saved work without inferring mastery from assisted recognition."""
    from app.services.statistics import metric

    weak = {}
    for event in events:
        if event["stage"] not in ("main", "reinforcement"):
            continue
        if (
            event["skipped"]
            or event["correct"] is False
            or event["fsrs_rating"] in (1, 2)
        ):
            weak[event["card_id"]] = True
        elif (
            event["source"] != "legacy"
            and not event["skipped"]
            and (
                (
                    event["kind"] == "typed"
                    and not event["assistance"]
                    and event["correct"] is True
                )
                or (event["kind"] == "self_rating" and event["self_rating"] in (3, 4))
            )
        ):
            weak.pop(event["card_id"], None)
    rows = [e for e in events if e["stage"] in ("main", "reinforcement")]
    return {
        "counts": {
            "main": sum(e["stage"] == "main" for e in rows),
            "reinforcement": sum(e["stage"] == "reinforcement" for e in rows),
            "skipped": sum(e["skipped"] for e in rows),
            "completed_cards": len({e["card_id"] for e in rows if e["scheduled"]}),
        },
        "metrics": {
            category: metric(rows, category)
            for category in ("retrieval", "assisted", "recognition", "self_report")
        },
        "weak_card_ids": list(weak),
    }
