"""Recovery plans through the public API on a migrated, isolated database."""

from uuid import uuid4

import pytest


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


def test_el19_recovery_requires_three_minute_budget(ec):
    before = ec.snapshot()
    for query in [
        "mode=recovery",
        "mode=recovery&budget_minutes=8",
        "mode=recovery&budget_minutes=15",
        "mode=unknown&budget_minutes=3",
    ]:
        assert ec.client.get(f"/api/today?{query}").status_code == 422
    assert ec.snapshot() == before


def test_el19_functional_rollback_hides_offer_preserves_saved_work(
    ec_factory, monkeypatch
):
    monkeypatch.setenv("RECOVERY_MODE_ENABLED", "false")
    ec = ec_factory()
    card_id = ec.seed_card()
    ec.set_time("2026-10-01T01:00:00Z")
    save_rating(ec, card_id, rating=1)
    ec.set_time("2026-10-05T01:00:00Z")
    before = ec.snapshot()
    assert ec.client.get("/api/today").json()["recovery_available"] is False
    assert ec.client.get("/api/today?budget_minutes=3&mode=recovery").status_code == 403
    assert ec.snapshot() == before
    # Previously frozen rounds submit via the unchanged learning boundary.
    save_rating(ec, card_id, session_id=str(uuid4()), stage="main")
    assert len(ec.snapshot()["learning_events"]) == 2


@pytest.mark.parametrize(
    "days,has_due,expected",
    [
        (2, True, False),
        (3, True, True),
        (2, False, False),
        (3, False, False),
        (30, True, True),
    ],
)
def test_el19_inactivity_and_due_boundaries(ec, days, has_due, expected):
    ec.set_time("2026-10-01T01:00:00Z")
    card_id = ec.seed_card(kind="word" if has_due else "sentence")
    ec.seed_card(word="fresh")
    save_rating(ec, card_id, rating=1)
    from datetime import UTC, datetime, timedelta

    ec.set_time(
        (datetime(2026, 10, 1, 1, tzinfo=UTC) + timedelta(days=days)).isoformat()
    )
    before = ec.snapshot()
    for _ in range(2):
        preview = ec.client.get("/api/today").json()
        assert preview["recovery_available"] is expected
        recovery = ec.client.get("/api/today?budget_minutes=3&mode=recovery").json()
        assert recovery["new_count"] == 0
        assert recovery["target"] == (1 if has_due else 0)
    assert ec.snapshot() == before


def test_el19_current_timezone_uses_immutable_saved_learning_day(ec):
    ec.set_time("2026-10-01T16:01:00Z")  # Shanghai: Oct 2
    card_id = ec.seed_card()
    save_rating(ec, card_id, rating=1)
    ec.set_time("2026-10-04T15:59:00Z")  # Shanghai: Oct 4, two-day span
    assert ec.client.get("/api/today").json()["recovery_available"] is False
    ec.set_time("2026-10-04T16:00:00Z")  # Shanghai: Oct 5, three-day span
    assert ec.client.get("/api/today").json()["recovery_available"] is True
    ec.settings.learning_timezone = "UTC"
    ec.restart()
    assert ec.client.get("/api/today").json()["recovery_available"] is False
    saved = ec.client.get(f"/api/cards/{card_id}").json()["learning_events"][0]
    assert saved["learning_day"] == "2026-10-02"
    assert saved["learning_timezone"] == "Asia/Shanghai"


def test_el19_skip_and_answer_contact_do_not_end_inactivity(ec):
    card_id = ec.seed_card()
    ec.set_time("2026-10-01T01:00:00Z")
    save_rating(ec, card_id, rating=1)
    ec.set_time("2026-10-05T01:00:00Z")
    response = ec.client.post(
        "/api/typing/check",
        json={
            "card_id": card_id,
            "user_input": "",
            "source": "spelling",
            "kind": "typed",
            "skipped": True,
            "submission_id": str(uuid4()),
        },
    )
    assert response.status_code == 200, response.text
    revision = ec.client.get(f"/api/cards/{card_id}").json()["content_revision"]
    contact = ec.client.post(
        "/api/learning/contacts",
        json={
            "card_id": card_id,
            "revision": revision,
            "kind": "answer_visible",
            "source": "study",
            "submission_id": str(uuid4()),
        },
    )
    assert contact.status_code == 200, contact.text
    assert ec.client.get("/api/today").json()["recovery_available"] is True


def test_el19_old_memory_is_unknown_but_saved_legacy_events_count_as_activity(ec):
    from datetime import datetime

    from app.models.review import Review

    card_id = ec.seed_card()
    with ec.SessionLocal() as db:
        db.add(
            Review(
                card_id=card_id,
                state=2,
                due=datetime(2026, 10, 1),
                stability=2,
                difficulty=5,
                elapsed_days=1,
                review_count=2,
                last_review=datetime(2026, 9, 1),
            )
        )
        db.commit()
    assert ec.client.get("/api/today").json()["recovery_available"] is False
    ec.set_time("2026-10-01T01:00:00Z")
    assert (
        ec.client.post(
            "/api/reviews", json={"card_id": card_id, "rating": 1}
        ).status_code
        == 200
    )
    ec.set_time("2026-10-05T01:00:00Z")
    assert ec.client.get("/api/today").json()["recovery_available"] is True


def test_el19_recovery_retains_priority_and_excludes_future_hard_words(ec):
    from datetime import datetime

    from app.models.error_card import ErrorCard
    from app.models.hard_card import HardCard
    from app.models.review import Review

    ids = [ec.seed_card(word=f"word{i}") for i in range(8)]
    ec.set_time("2026-10-01T01:00:00Z")
    for card_id in ids[:6]:
        save_rating(ec, card_id, rating=1)
    with ec.SessionLocal() as db:
        db.add(ErrorCard(card_id=ids[4], error_count=9))
        db.add(HardCard(card_id=ids[5]))
        db.add(HardCard(card_id=ids[6]))
        db.add(
            Review(
                card_id=ids[6],
                state=2,
                due=datetime(2030, 1, 1),
                stability=2,
                difficulty=5,
                elapsed_days=1,
                review_count=2,
            )
        )
        db.commit()
    ec.set_time("2026-10-05T01:00:00Z")
    data = ec.client.get("/api/today?budget_minutes=3&mode=recovery").json()
    assert [card["id"] for card in data["queue"]] == [ids[4], ids[5], *ids[:3]]
    assert (data["remaining_due"], data["new_count"]) == (1, 0)


def test_el19_failed_save_and_parallel_replays_schedule_once(ec):
    from concurrent.futures import ThreadPoolExecutor

    card_id = ec.seed_card()
    ec.set_time("2026-10-01T01:00:00Z")
    save_rating(ec, card_id, rating=1)
    ec.set_time("2026-10-05T01:00:00Z")
    card = ec.client.get("/api/today?budget_minutes=3&mode=recovery").json()["queue"][0]
    command = {
        "card_id": card_id,
        "rating": 3,
        "kind": "self_rating",
        "source": "study",
        "session_id": str(uuid4()),
        "stage": "main",
        "revision": card["content_revision"],
        "submission_id": str(uuid4()),
    }
    before = ec.snapshot()
    ec.fail_commit_once()
    assert ec.client.post("/api/reviews", json=command).status_code == 500
    assert ec.snapshot() == before
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(
            pool.map(lambda _: ec.client.post("/api/reviews", json=command), range(2))
        )
    assert [r.status_code for r in results] == [200, 200]
    assert results[0].json()["event_id"] == results[1].json()["event_id"]
    assert (
        ec.client.post("/api/reviews", json={**command, "rating": 4}).status_code == 409
    )
    assert len(ec.snapshot()["learning_events"]) == 2
    assert (
        ec.client.get(f"/api/sessions/{command['session_id']}/summary").json()[
            "counts"
        ]["main"]
        == 1
    )


def test_el19_three_minute_recovery_survives_budget_selector_rollback(ec):
    ec.settings.time_budget_enabled = False
    data = ec.client.get("/api/today?budget_minutes=3&mode=recovery").json()
    assert data["plan"]["budget_minutes"] == 3
    assert data["plan"]["mode"] == "recovery"


def test_el19_v3_restore_preserves_activity_revision_replay_and_remaining_due(
    ec, ec_factory
):
    ids = [ec.seed_card(word=f"old{i}") for i in range(3)]
    ec.set_time("2026-10-01T01:00:00Z")
    for card_id in ids:
        save_rating(ec, card_id, rating=1)
    ec.set_time("2026-10-05T01:00:00Z")
    card = ec.client.get("/api/today?budget_minutes=3&mode=recovery").json()["queue"][0]
    command = {
        "card_id": ids[0],
        "rating": 3,
        "kind": "self_rating",
        "source": "study",
        "session_id": str(uuid4()),
        "stage": "main",
        "revision": card["content_revision"],
        "submission_id": str(uuid4()),
    }
    saved = ec.client.post("/api/reviews", json=command)
    assert saved.status_code == 200
    backup = ec.client.get("/api/export/backup").json()
    other = ec_factory()
    other.seed_card(word="replace", id=900)
    other.set_time("2026-10-05T01:00:00Z")
    preview = other.client.post("/api/import/preview", json=backup)
    assert preview.status_code == 200, preview.text
    result = other.client.post(
        "/api/import/cards",
        json={
            "backup": backup,
            "expected_revision": preview.json()["expected_revision"],
        },
    )
    assert result.status_code == 200, result.text
    restored = other.snapshot()
    mapped_id = next(row["id"] for row in restored["cards"] if row["word"] == "old0")
    assert mapped_id != ids[0]
    assert [e["learning_day"] for e in restored["learning_events"]] == [
        "2026-10-01"
    ] * 3 + ["2026-10-05"]
    assert other.client.get("/api/today").json()["recovery_available"] is False
    summary = other.client.get(f"/api/sessions/{command['session_id']}/summary").json()
    assert (summary["counts"]["main"], summary["remaining_due"]) == (1, 2)
    mapped = {**command, "card_id": mapped_id}
    assert (
        other.client.put(
            f"/api/cards/{mapped_id}", json={"meaning": "新含义"}
        ).status_code
        == 200
    )
    replay = other.client.post("/api/reviews", json=mapped)
    assert replay.status_code == 200
    assert replay.json()["event_id"] == saved.json()["event_id"]
    assert (
        other.client.post("/api/reviews", json={**mapped, "rating": 4}).status_code
        == 409
    )
    assert len(other.snapshot()["learning_events"]) == 4


def test_el19_long_interruption_caps_even_fast_personal_review_estimates(ec):
    ids = [ec.seed_card(word=f"fast{i}") for i in range(12)]
    ec.seed_card(word="fresh")
    ec.set_time("2026-10-01T01:00:00Z")
    for card_id in ids:
        save_rating(ec, card_id, rating=1)
    for card_id in ids[:5]:
        submission_id = str(uuid4())
        save_rating(ec, card_id, rating=1, submission_id=submission_id)
        assert (
            ec.client.post(
                "/api/learning/durations",
                json={
                    "sample_id": str(uuid4()),
                    "submission_id": submission_id,
                    "kind": "review",
                    "active_ms": 2000,
                },
            ).status_code
            == 200
        )
    ec.set_time("2026-11-01T01:00:00Z")
    regular = ec.client.get("/api/today?budget_minutes=3").json()
    assert regular["review_count"] == 12
    recovery = ec.client.get("/api/today?budget_minutes=3&mode=recovery").json()
    assert recovery["recovery_available"] is True
    assert (
        recovery["review_count"],
        recovery["remaining_due"],
        recovery["new_count"],
    ) == (5, 7, 0)
    assert recovery["plan"]["estimates"]["review"]["seconds"] == 2
