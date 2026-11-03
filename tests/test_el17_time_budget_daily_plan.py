"""Time-budget daily plans through the public, migrated application."""


def test_el17_three_minute_plan_is_bounded(ec):
    for i in range(8):
        ec.seed_card(word=f"word{i}", meaning=f"词{i}")
    response = ec.client.get("/api/today", params={"budget_minutes": 3})
    assert response.status_code == 200
    data = response.json()
    assert data["plan"] == {
        "budget_minutes": 3,
        "estimated_seconds": 135,
        "estimate_basis": "default",
        "mode": "regular",
        "reinforcement_limit": 2,
    }
    assert data["new_count"] == data["target"] == len(data["queue"]) == 2


def save_rating(ec, card_id, rating=3):
    from uuid import uuid4

    result = ec.client.post(
        "/api/reviews",
        json={
            "card_id": card_id,
            "rating": rating,
            "source": "study",
            "kind": "self_rating",
            "submission_id": str(uuid4()),
        },
    )
    assert result.status_code == 200
    return result.json()


def test_el17_next_round_subtracts_first_scheduled_new_cards(ec):
    ids = [ec.seed_card(word=f"new{i}") for i in range(15)]
    save_rating(ec, ids[0])
    save_rating(ec, ids[0])
    result = ec.client.get("/api/today?budget_minutes=15").json()
    assert result["recommended_goal"] == 10
    assert result["new_remaining"] == 9
    assert result["new_count"] == 9


def test_el17_due_cap_never_fills_backlog_with_new_cards(ec):
    from datetime import datetime

    from app.models.review import Review

    due = [ec.seed_card(word=f"due{i}") for i in range(25)]
    ec.seed_card(word="new")
    with ec.SessionLocal() as db:
        for card_id in due:
            db.add(
                Review(
                    card_id=card_id,
                    state=2,
                    due=datetime(2026, 10, 29),
                    stability=2,
                    difficulty=5,
                    elapsed_days=1,
                    review_count=2,
                )
            )
        db.commit()
    for budget, count, remainder in [(3, 5, 20), (8, 20, 5), (15, 20, 5)]:
        result = ec.client.get(f"/api/today?budget_minutes={budget}").json()
        assert (
            result["review_count"],
            result["remaining_due"],
            result["new_count"],
        ) == (count, remainder, 0)
        assert [card["id"] for card in result["queue"]] == due[:count]


def test_el17_preview_is_read_only_and_validates_budget(ec):
    ec.seed_card()
    before = ec.snapshot()
    for value in ["0", "5", "3.0", "true", "oops"]:
        assert ec.client.get(f"/api/today?budget_minutes={value}").status_code == 422
    for value in [3, 8, 15]:
        assert ec.client.get(f"/api/today?budget_minutes={value}").status_code == 200
    assert ec.client.get("/api/today").json()["plan"]["budget_minutes"] == 8
    assert ec.snapshot() == before


def test_el17_frozen_revision_conflict_does_not_schedule(ec):
    from uuid import uuid4

    card_id = ec.seed_card()
    card = ec.client.get("/api/today?budget_minutes=3").json()["queue"][0]
    assert (
        ec.client.put(
            f"/api/cards/{card_id}", json={"meaning": "修订后的苹果"}
        ).status_code
        == 200
    )
    command = {
        "card_id": card_id,
        "rating": 3,
        "source": "study",
        "kind": "self_rating",
        "stage": "main",
        "session_id": str(uuid4()),
        "submission_id": str(uuid4()),
        "revision": card["content_revision"],
    }
    response = ec.client.post("/api/reviews", json=command)
    assert response.status_code == 409
    assert "内容已修改" in response.json()["detail"]
    assert ec.client.get(f"/api/cards/{card_id}").json()["learning_events"] == []


def test_el17_old_memory_without_event_history_is_not_a_new_card(ec):
    from datetime import datetime

    from app.models.review import Review

    card_id = ec.seed_card(word="old")
    ec.seed_card(word="fresh")
    with ec.SessionLocal() as db:
        db.add(
            Review(
                card_id=card_id,
                state=2,
                due=datetime(2026, 10, 29),
                last_review=datetime(2026, 10, 28),
                stability=2,
                difficulty=5,
                elapsed_days=1,
                review_count=2,
            )
        )
        db.commit()
    save_rating(ec, card_id)
    assert ec.client.get("/api/today").json()["new_remaining"] == 10


def test_el17_sentence_schedule_does_not_spend_word_quota(ec):
    card_id = ec.seed_card(word="sentence", kind="sentence")
    save_rating(ec, card_id)
    assert ec.client.get("/api/today").json()["new_remaining"] == 10


def test_el17_existing_due_limit_preserves_backlog_without_new_cards(ec):
    from datetime import datetime

    from app.models.review import Review

    for i in range(4):
        card_id = ec.seed_card(word=f"due{i}")
        with ec.SessionLocal() as db:
            db.add(
                Review(
                    card_id=card_id,
                    state=2,
                    due=datetime(2026, 10, 29),
                    stability=2,
                    difficulty=5,
                    elapsed_days=1,
                    review_count=2,
                )
            )
            db.commit()
    ec.seed_card(word="fresh")
    data = ec.client.get("/api/today?budget_minutes=15&due_limit=2").json()
    assert (data["review_count"], data["remaining_due"], data["new_count"]) == (2, 2, 0)


def test_el17_equal_time_repeats_keep_saved_order_for_quota(ec, monkeypatch):
    from uuid import UUID

    card_id = ec.seed_card()
    event_ids = iter(
        [
            UUID("ffffffff-ffff-4fff-8fff-ffffffffffff"),
            UUID("00000000-0000-4000-8000-000000000001"),
        ]
    )
    monkeypatch.setattr("app.services.learning.uuid4", lambda: next(event_ids))
    save_rating(ec, card_id)
    assert ec.client.get("/api/today").json()["new_remaining"] == 9
    save_rating(ec, card_id)
    assert ec.client.get("/api/today").json()["new_remaining"] == 9
