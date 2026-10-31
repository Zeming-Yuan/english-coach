"""Daily learning queue contracts, observed through the public today API."""

from uuid import uuid4


def test_daily_queue_is_due_first(ec):
    new_id = ec.seed_card(word="new")
    due_id = ec.seed_card(word="old")
    ec.set_time("2026-10-29T01:00:00+00:00")
    assert (
        ec.client.post(
            "/api/reviews",
            json={
                "card_id": due_id,
                "rating": 3,
                "source": "study",
                "kind": "self_rating",
                "submission_id": str(uuid4()),
            },
        ).status_code
        == 200
    )
    ec.set_time("2026-11-30T01:00:00+00:00")
    result = ec.client.get("/api/today").json()
    assert [c["id"] for c in result["queue"]] == [due_id, new_id]
    assert result["target"] == 2


def test_daily_queue_prioritizes_tags_inside_due_and_new_groups(ec):
    from datetime import datetime

    from app.models.error_card import ErrorCard
    from app.models.hard_card import HardCard
    from app.models.review import Review

    ids = [ec.seed_card(word=f"due{i}") for i in range(25)]
    new_ids = [ec.seed_card(word=f"new{i}") for i in range(12)]
    future = ec.seed_card(word="future-hard")
    with ec.SessionLocal() as db:
        for card_id in ids + [future]:
            db.add(
                Review(
                    card_id=card_id,
                    state=2,
                    step=None,
                    due=datetime(2026, 10, 29)
                    if card_id != future
                    else datetime(2026, 12, 1),
                    stability=2,
                    difficulty=5,
                    elapsed_days=1,
                    review_count=2,
                )
            )
        db.add_all(
            [
                ErrorCard(card_id=ids[-1], error_count=4),
                ErrorCard(card_id=ids[-1], error_count=2),
                HardCard(card_id=ids[-1]),
                HardCard(card_id=future),
                HardCard(card_id=new_ids[-1]),
            ]
        )
        db.commit()
    result = ec.client.get("/api/today").json()
    assert [card["id"] for card in result["queue"]][:2] == [ids[-1], ids[0]]
    assert result["queue"][20]["id"] == new_ids[-1]
    assert result["review_count"] == 20
    assert result["remaining_due"] == 5
    assert result["new_count"] == 10
    assert result["target"] == 30
    assert len({c["id"] for c in result["queue"]}) == 30
    assert future not in [card["id"] for card in result["queue"]]


def test_daily_queue_uses_current_state_not_stale_due_rows(ec):
    from datetime import datetime

    from app.models.review import Review

    card_id = ec.seed_card(word="already-reviewed")
    with ec.SessionLocal() as db:
        for due, last in [
            (datetime(2026, 10, 1), datetime(2026, 9, 30)),
            (datetime(2026, 12, 1), datetime(2026, 10, 30)),
        ]:
            db.add(
                Review(
                    card_id=card_id,
                    state=2,
                    due=due,
                    last_review=last,
                    stability=2,
                    difficulty=5,
                    elapsed_days=1,
                    review_count=2,
                )
            )
        db.commit()
    result = ec.client.get("/api/today").json()
    assert result["queue"] == []
    assert result["remaining_due"] == result["target"] == 0


def test_daily_quota_stays_lowered_and_empty_counts_are_explicit(ec):
    empty = ec.client.get("/api/today").json()
    assert (
        empty["queue"],
        empty["review_count"],
        empty["new_count"],
        empty["target"],
    ) == ([], 0, 0, 0)
    ids = [ec.seed_card(word=f"quota{i}") for i in range(8)]
    assert (
        ec.client.post(
            "/api/reviews",
            json={
                "card_id": ids[0],
                "rating": 1,
                "source": "study",
                "kind": "self_rating",
                "submission_id": str(uuid4()),
            },
        ).status_code
        == 200
    )
    result = ec.client.get("/api/today").json()
    assert result["recommended_goal"] == 5
    assert result["sample_count"] == 1
    assert result["new_count"] == 5
    assert result["target"] == 5
