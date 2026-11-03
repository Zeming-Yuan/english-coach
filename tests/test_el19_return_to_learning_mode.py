"""Recovery plans through the public API on a migrated, isolated database."""

from uuid import uuid4


def save_rating(ec, card_id, **extra):
    response = ec.client.post(
        "/api/reviews",
        json={
            "card_id": card_id,
            "rating": 3,
            "source": "study",
            "kind": "self_rating",
            "submission_id": str(uuid4()),
            **extra,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_el19_only_real_activity_ends_inactivity(ec):
    ids = [ec.seed_card(word=f"word{i}") for i in range(8)]
    ec.set_time("2026-10-01T01:00:00Z")
    for card_id in ids[:7]:
        save_rating(ec, card_id, rating=1)
    ec.set_time("2026-10-05T01:00:00Z")
    before = ec.snapshot()
    preview = ec.client.get("/api/today").json()
    assert preview["recovery_available"] is True
    assert preview["plan"]["mode"] == "regular"
    chosen = ec.client.get(
        "/api/today", params={"budget_minutes": 3, "mode": "recovery"}
    ).json()
    assert chosen["plan"]["mode"] == "recovery"
    assert chosen["new_count"] == 0
    assert chosen["target"] == 5
    assert chosen["remaining_due"] == 2
    assert [card["id"] for card in chosen["queue"]] == ids[:5]
    assert ec.snapshot() == before
    save_rating(ec, ids[0])
    assert ec.client.get("/api/today").json()["recovery_available"] is False


def test_el19_summary_reports_actual_remaining_due(ec):
    ids = [ec.seed_card(word=f"due{i}") for i in range(3)]
    ec.set_time("2026-10-01T01:00:00Z")
    for card_id in ids:
        save_rating(ec, card_id, rating=1)
    ec.set_time("2026-10-05T01:00:00Z")
    session_id = str(uuid4())
    save_rating(ec, ids[0], session_id=session_id, stage="main")
    summary = ec.client.get(f"/api/sessions/{session_id}/summary").json()
    assert summary["counts"]["completed_cards"] == 1
    assert summary["remaining_due"] == 2
