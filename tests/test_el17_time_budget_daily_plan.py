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
        "may_exceed_budget": False,
        "estimate_basis": "default",
        "estimates": {
            "review": {"seconds": 20, "basis": "default", "sample_count": 0},
            "new": {"seconds": 40, "basis": "default", "sample_count": 0},
            "reinforcement": {"seconds": 20, "basis": "default", "sample_count": 0},
        },
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


def daily_command(ec, card_id):
    from uuid import uuid4

    revision = ec.client.get(f"/api/cards/{card_id}").json()["content_revision"]
    return {
        "card_id": card_id,
        "rating": 3,
        "source": "study",
        "kind": "self_rating",
        "stage": "main",
        "session_id": str(uuid4()),
        "submission_id": str(uuid4()),
        "revision": revision,
    }


def restore_backup(ec, backup):
    preview = ec.client.post("/api/import/preview", json=backup)
    assert preview.status_code == 200, preview.text
    result = ec.client.post(
        "/api/import/cards",
        json={
            "backup": backup,
            "expected_revision": preview.json()["expected_revision"],
        },
    )
    assert result.status_code == 200, result.text


def test_el17_v3_remaps_cards_preserves_revision_and_replays_after_edit(ec, ec_factory):
    from uuid import uuid4

    card_id = ec.seed_card()
    command = daily_command(ec, card_id)
    saved = ec.client.post("/api/reviews", json=command)
    assert saved.status_code == 200
    backup = ec.client.get("/api/export/backup").json()
    other = ec_factory()
    other.seed_card(word="replace", id=900)
    restore_backup(other, backup)
    restored = other.client.get("/api/cards").json()["cards"][0]
    mapped = {**command, "card_id": restored["id"]}
    assert restored["id"] != card_id
    assert restored["content_revision"] == command["revision"]
    assert other.client.get("/api/today").json()["new_remaining"] == 9
    assert (
        other.client.put(
            f"/api/cards/{restored['id']}", json={"meaning": "已更新"}
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
    assert (
        other.client.post(
            "/api/reviews", json={**mapped, "submission_id": str(uuid4())}
        ).status_code
        == 409
    )
    assert (
        len(other.client.get(f"/api/cards/{restored['id']}").json()["learning_events"])
        == 1
    )


def test_el17_revision_save_failure_and_concurrent_confirmation_are_atomic(ec):
    from concurrent.futures import ThreadPoolExecutor

    card_id = ec.seed_card()
    command = daily_command(ec, card_id)
    before = ec.snapshot()
    ec.fail_commit_once()
    assert ec.client.post("/api/reviews", json=command).status_code == 500
    assert ec.snapshot() == before
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(
            pool.map(lambda _: ec.client.post("/api/reviews", json=command), range(2))
        )
    assert [result.status_code for result in results] == [200, 200]
    assert results[0].json() == results[1].json()
    backup = ec.client.get("/api/export/backup").json()
    assert len(backup["learning_events"]) == len(backup["reviews"]) == 1
    assert backup["reviews"][0]["review_count"] == 1
    assert (
        backup["learning_events"][0]["command_json"]["revision"] == command["revision"]
    )
    assert ec.client.get("/api/today").json()["new_remaining"] == 9


def test_el17_daily_quota_exhausts_and_resets_on_the_event_learning_day(ec):
    ids = [ec.seed_card(word=f"word{i}") for i in range(12)]
    for card_id in ids[:10]:
        save_rating(ec, card_id)
    data = ec.client.get("/api/today?budget_minutes=15").json()
    assert data["new_remaining"] == data["new_count"] == data["target"] == 0
    ec.set_time("2026-10-30T16:01:00+00:00")
    data = ec.client.get("/api/today?budget_minutes=15").json()
    assert data["new_remaining"] == 10
    assert data["new_count"] == 2


def test_el17_v3_rejects_a_revision_precondition_unrelated_to_saved_event(ec):
    from copy import deepcopy

    from app.schemas.learning import AttemptCommand
    from app.services.learning import canonical_attempt

    card_id = ec.seed_card()
    command = daily_command(ec, card_id)
    assert ec.client.post("/api/reviews", json=command).status_code == 200
    backup = ec.client.get("/api/export/backup").json()
    corrupted = deepcopy(backup)
    event = corrupted["learning_events"][0]
    event["command_json"]["revision"]["version"] += 1
    # Keep the command internally consistent to exercise the event/revision link.
    event["fingerprint"] = canonical_attempt(
        AttemptCommand.model_validate(event["command_json"])
    )
    before = ec.snapshot()
    response = ec.client.post("/api/import/preview", json=corrupted)
    assert response.status_code == 422
    assert "revision" in response.text
    assert ec.snapshot() == before


def test_el17_v2_cannot_silently_drop_a_revision_precondition(ec):
    from copy import deepcopy

    card_id = ec.seed_card()
    command = daily_command(ec, card_id)
    assert ec.client.post("/api/reviews", json=command).status_code == 200
    backup = deepcopy(ec.client.get("/api/export/backup").json())
    backup["version"] = 2
    backup.pop("features")
    backup.pop("extensions")
    for event in backup["learning_events"]:
        event.pop("card_identity", None)
        event.pop("card_revision", None)
    response = ec.client.post("/api/import/preview", json=backup)
    assert response.status_code == 422
    assert "V3" in response.text


def test_el17_functional_rollback_defaults_to_eight_without_losing_events(ec):
    ids = [ec.seed_card(word=f"word{i}") for i in range(12)]
    save_rating(ec, ids[0])
    before = ec.snapshot()
    ec.app.state.settings = ec.settings.model_copy(
        update={"time_budget_enabled": False}
    )
    data = ec.client.get("/api/today?budget_minutes=3").json()
    assert data["plan"]["budget_minutes"] == 8
    assert data["time_budget_enabled"] is False
    assert data["new_remaining"] == data["new_count"] == 9
    assert ec.snapshot() == before


def test_el17_reinforcement_revision_conflict_is_recoverable(ec):
    from uuid import uuid4

    card_id = ec.seed_card()
    command = {**daily_command(ec, card_id), "rating": 1}
    assert ec.client.post("/api/reviews", json=command).status_code == 200
    question = ec.client.get(
        f"/api/sessions/{command['session_id']}/reinforcement"
    ).json()["questions"][0]
    assert (
        ec.client.put(f"/api/cards/{card_id}", json={"meaning": "已修改"}).status_code
        == 200
    )
    response = ec.client.post(
        "/api/typing/check",
        json={
            "submission_id": str(uuid4()),
            "session_id": command["session_id"],
            "card_id": card_id,
            "kind": "typed",
            "source": "reinforcement",
            "stage": "reinforcement",
            "user_input": "apple",
            "revision": question["content_revision"],
        },
    )
    assert response.status_code == 409
    assert "内容已修改" in response.text
    summary = ec.client.get(f"/api/sessions/{command['session_id']}/summary").json()
    assert summary["counts"]["reinforcement"] == 0


def test_el17_migrated_baseline_does_not_spend_new_word_quota(ec):
    from datetime import datetime
    from pathlib import Path

    from alembic.config import Config

    from alembic import command
    from app.models.review import Review

    card_id = ec.seed_card(word="legacy")
    ec.seed_card(word="fresh")
    ec.rebuild_legacy_database("b1c2d3e4f501")
    with ec.SessionLocal() as db:
        db.add(
            Review(
                card_id=card_id,
                state=1,
                step=0,
                due=datetime(2026, 10, 29),
                last_review=None,
                stability=2,
                difficulty=5,
                elapsed_days=0,
                review_count=2,
            )
        )
        db.commit()
    cfg = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", ec.database_url)
    command.upgrade(cfg, "head")
    assert len(ec.client.get("/api/export/backup").json()["review_baselines"]) == 1
    save_rating(ec, card_id)
    assert ec.client.get("/api/today").json()["new_remaining"] == 10


def test_el17_skip_and_assisted_input_do_not_spend_new_word_quota(ec):
    from uuid import uuid4

    card_id = ec.seed_card()
    skipped = {**daily_command(ec, card_id), "rating": None, "skipped": True}
    assert ec.client.post("/api/reviews", json=skipped).status_code == 200
    assisted = ec.client.post(
        "/api/typing/check",
        json={
            "card_id": card_id,
            "user_input": "apple",
            "kind": "typed",
            "source": "spelling",
            "assistance": ["answer_visible"],
            "submission_id": str(uuid4()),
        },
    )
    assert assisted.status_code == 200
    assert assisted.json()["scheduled"] is False
    assert ec.client.get("/api/today").json()["new_remaining"] == 10
    save_rating(ec, card_id)
    assert ec.client.get("/api/today").json()["new_remaining"] == 9
