"""EL-09：公开 HTTP 验证真实间隔、首测、恢复与统一排期。"""

from datetime import timedelta
from uuid import uuid4

import pytest


def _basis(ec, word="apple"):
    card_id = ec.seed_card(word=word)
    ec.set_time("2026-10-01T01:00:00Z")
    assert (
        ec.client.post(
            "/api/typing/check",
            json={
                "card_id": card_id,
                "user_input": word,
                "source": "spelling",
                "submission_id": str(uuid4()),
            },
        ).status_code
        == 200
    )
    revision = ec.client.get(f"/api/cards/{card_id}").json()["content_revision"]
    assert (
        ec.client.post(
            "/api/learning/contacts",
            json={
                "submission_id": str(uuid4()),
                "card_id": card_id,
                "revision": revision,
                "source": "card_detail",
                "kind": "answer_visible",
            },
        ).status_code
        == 200
    )
    return card_id


def _create(ec, window="week", **extra):
    return ec.client.post(
        "/api/practice-sessions",
        json={
            "id": str(uuid4()),
            "purpose": "delayed_check",
            "window": window,
            "pending_contact_ids": [],
            **extra,
        },
    )


def _attempt(ec, run, **extra):
    return ec.client.post(
        f"/api/practice-sessions/{run['id']}/items/{run['items'][0]['id']}/attempts",
        json={"submission_id": str(uuid4()), "answer": "apple", **extra},
    )


def test_el09_week_check_uses_recorded_gap(ec):
    card_id = _basis(ec)
    ec.set_time("2026-10-08T01:00:00Z")
    response = _create(ec)
    assert response.status_code == 200, response.text
    item = response.json()["items"][0]
    assert item["card_id"] == card_id
    assert item["gap_seconds"] == 604800
    assert item["window"] == "week"
    assert "apple" not in response.text


def test_el09_independent_week_success_counts_and_schedules_once(ec):
    card_id = _basis(ec)
    ec.set_time("2026-10-08T01:00:00Z")
    run = _create(ec).json()
    submission_id = str(uuid4())
    first = _attempt(ec, run, submission_id=submission_id)
    assert first.status_code == 200, first.text
    replay = _attempt(ec, run, submission_id=submission_id)
    assert replay.json()["event_id"] == first.json()["event_id"]
    second = _attempt(ec, run)
    assert second.status_code == 409, second.text
    stats = ec.client.get("/api/stats").json()["retention"]["week"]
    assert (stats["successes"], stats["count"], stats["covered"]) == (1, 1, 1)
    assert stats["gap_seconds"] == [604800]
    detail = ec.client.get(f"/api/cards/{card_id}").json()
    assert detail["learning_evidence"]["retention"]["status"] == "verified"
    assert len(detail["learning_events"]) == 2
    assert sum(event["scheduled"] for event in detail["learning_events"]) == 2
    assert _create(ec).json()["items"] == []


@pytest.mark.parametrize(
    "stamp,window,count",
    [
        ("2026-10-02T00:59:59Z", "day", 0),
        ("2026-10-02T01:00:00Z", "day", 1),
        ("2026-10-04T01:00:00Z", "day", 0),
        ("2026-10-08T00:59:59Z", "week", 0),
        ("2026-10-08T01:00:00Z", "week", 1),
        ("2026-10-15T01:00:00Z", "week", 0),
    ],
)
def test_el09_utc_window_boundaries(ec, stamp, window, count):
    _basis(ec)
    ec.set_time(stamp)
    assert len(_create(ec, window).json()["items"]) == count


def test_el09_submit_after_window_moves_to_other(ec):
    _basis(ec)
    ec.set_time("2026-10-08T01:00:00Z")
    run = _create(ec).json()
    ec.set_time("2026-10-15T01:00:00Z")
    result = _attempt(ec, run).json()
    assert result["session"]["items"][0]["window"] == "other"
    stats = ec.client.get("/api/stats").json()["retention"]
    assert stats["other"]["count"] == 1
    assert stats["week"]["count"] == 0


@pytest.mark.parametrize("mode", ["contact", "pending", "help", "skip"])
def test_el09_disqualified_or_assisted_first_result_stays_frozen(ec, mode):
    card_id = _basis(ec)
    ec.set_time("2026-10-08T01:00:00Z")
    run = _create(ec).json()
    extra = {}
    if mode == "contact":
        revision = ec.client.get(f"/api/cards/{card_id}").json()["content_revision"]
        assert (
            ec.client.post(
                "/api/learning/contacts",
                json={
                    "submission_id": str(uuid4()),
                    "card_id": card_id,
                    "revision": revision,
                    "source": "words_list",
                    "kind": "answer_visible",
                },
            ).status_code
            == 200
        )
    elif mode == "pending":
        extra["pending_contact_ids"] = [str(uuid4())]
    elif mode == "help":
        assert (
            ec.client.post(
                f"/api/practice-sessions/{run['id']}/items/{run['items'][0]['id']}/assistance",
                json={"kind": "first_letter"},
            ).status_code
            == 200
        )
    else:
        extra = {"skipped": True, "answer": None}
    first = _attempt(ec, run, **extra)
    assert first.status_code == 200, first.text
    assert _attempt(ec, run).status_code == 409
    stats = ec.client.get("/api/stats").json()["retention"]
    assert stats["week"]["count"] == 0
    assert (
        ec.client.get(f"/api/cards/{card_id}").json()["learning_evidence"]["retention"][
            "status"
        ]
        == "insufficient"
    )
    if mode == "help":
        assert stats["week"]["assisted"] == 1
    elif mode == "skip":
        assert stats["week"]["skipped"] == 1
    else:
        assert first.json()["session"]["items"][0]["window"] == "other"


def test_el09_v3_roundtrip_keeps_basis_and_first_result(ec, ec_factory):
    _basis(ec)
    ec.set_time("2026-10-08T01:00:00Z")
    run = _create(ec).json()
    assert _attempt(ec, run).status_code == 200
    backup = ec.client.get("/api/export/backup").json()
    target = ec_factory()
    target.set_time("2026-10-08T01:00:00Z")
    preview = target.client.post("/api/import/preview", json=backup)
    assert preview.status_code == 200, preview.text
    restored = target.client.post(
        "/api/import/cards",
        json={
            "backup": backup,
            "expected_revision": preview.json()["expected_revision"],
        },
    )
    assert restored.status_code == 200, restored.text
    assert (
        target.client.get(f"/api/practice-sessions/{run['id']}").json()["items"][0][
            "gap_seconds"
        ]
        == 604800
    )
    assert target.client.get("/api/stats").json()["retention"]["week"]["count"] == 1


@pytest.mark.parametrize(
    "failure_time", ["2026-10-08T01:00:00Z", "2026-10-09T01:00:00Z"]
)
def test_el09_new_independent_failure_weakens_retention_but_keeps_success_date(
    ec, failure_time
):
    card_id = _basis(ec)
    ec.set_time("2026-10-08T01:00:00Z")
    assert _attempt(ec, _create(ec).json()).status_code == 200
    ec.set_time(failure_time)
    assert (
        ec.client.post(
            "/api/typing/check",
            json={
                "card_id": card_id,
                "user_input": "wrong",
                "source": "spelling",
                "submission_id": str(uuid4()),
            },
        ).status_code
        == 200
    )
    retention = ec.client.get(f"/api/cards/{card_id}").json()["learning_evidence"][
        "retention"
    ]
    assert retention["status"] == "weak"
    assert retention["last_verified_at"].startswith("2026-10-08")


def test_el09_first_processed_order_wins_across_tabs_at_same_time(ec, ec_factory):
    _basis(ec)
    ec.set_time("2026-10-08T01:00:00Z")
    earlier_created = _create(ec).json()
    later_created = _create(ec).json()
    assert _attempt(ec, later_created, answer=None, skipped=True).status_code == 200
    assert _attempt(ec, earlier_created).status_code == 200
    stats = ec.client.get("/api/stats").json()["retention"]["week"]
    assert (stats["skipped"], stats["count"]) == (1, 0)


def test_el09_candidates_prioritize_weak_words_and_limit_three(ec):
    for word in ["book", "cat", "dog"]:
        _basis(ec, word)
    weak_id = _basis(ec)
    ec.set_time("2026-10-02T01:00:00Z")
    assert (
        ec.client.post(
            "/api/typing/check",
            json={
                "card_id": weak_id,
                "user_input": "wrong",
                "source": "spelling",
                "submission_id": str(uuid4()),
            },
        ).status_code
        == 200
    )
    ec.set_time("2026-10-09T01:00:00Z")
    items = _create(ec).json()["items"]
    assert len(items) == 3
    assert items[0]["card_id"] == weak_id


@pytest.mark.parametrize(
    "mutation", ["gap", "window", "anchor", "missing-result", "foreign-revision"]
)
def test_el09_v3_rejects_fabricated_retention_without_writes(ec, ec_factory, mutation):
    _basis(ec)
    ec.set_time("2026-10-08T01:00:00Z")
    assert _attempt(ec, _create(ec).json()).status_code == 200
    backup = ec.client.get("/api/export/backup").json()
    item = backup["extensions"]["practice_items"][0]
    if mutation == "gap":
        item["retention_result"]["gap_seconds"] = 1209600
    elif mutation == "window":
        item["retention_result"]["window"] = "day"
    elif mutation == "anchor":
        item["retention_basis"]["anchor_id"] = str(uuid4())
    elif mutation == "missing-result":
        item["retention_result"] = None
    else:
        item["retention_basis"]["anchor_kind"] = "unknown"
    target = ec_factory()
    before = target.snapshot()
    assert target.client.post("/api/import/preview", json=backup).status_code == 422
    assert target.snapshot() == before


@pytest.mark.parametrize("operation", ["create", "attempt"])
def test_el09_write_failure_retries_same_identity_once(ec, operation):
    card_id = _basis(ec)
    ec.set_time("2026-10-08T01:00:00Z")
    identity = str(uuid4())
    run = _create(ec).json() if operation == "attempt" else None

    def save():
        return (
            _attempt(ec, run, submission_id=identity)
            if run
            else _create(ec, id=identity)
        )

    before = ec.snapshot()
    ec.fail_commit_once()
    assert save().status_code == 500
    assert ec.snapshot() == before
    first = save()
    assert first.status_code == 200, first.text
    after = ec.snapshot()
    assert save().status_code == 200
    assert ec.snapshot() == after
    assert len(ec.client.get(f"/api/cards/{card_id}").json()["learning_events"]) == (
        2 if run else 1
    )


def test_el09_saved_replay_precedes_revision_conflict_and_new_attempt_is_stale(ec):
    card_id = _basis(ec)
    ec.set_time("2026-10-08T01:00:00Z")
    run = _create(ec).json()
    submission_id = str(uuid4())
    assert _attempt(ec, run, submission_id=submission_id).status_code == 200
    assert (
        ec.client.put(f"/api/cards/{card_id}", json={"meaning": "新释义"}).status_code
        == 200
    )
    assert _attempt(ec, run, submission_id=submission_id).status_code == 200
    assert _attempt(ec, run).status_code == 409
    assert (
        _attempt(ec, run, submission_id=submission_id, answer="other").status_code
        == 409
    )
    assert ec.client.delete(f"/api/cards/{card_id}").status_code == 200
    assert _attempt(ec, run).status_code == 404
    assert ec.client.get(f"/api/practice-sessions/{run['id']}").json()["items"] == []


def test_el09_pending_or_missing_current_contact_never_creates_candidates(ec):
    card_id = _basis(ec)
    ec.set_time("2026-10-08T01:00:00Z")
    assert _create(ec, pending_contact_ids=[str(uuid4())]).json()["items"] == []
    assert (
        ec.client.put(f"/api/cards/{card_id}", json={"meaning": "新释义"}).status_code
        == 200
    )
    assert _create(ec).json()["items"] == []


def test_el09_v3_cannot_ignore_a_newer_confirmed_contact(ec):
    card_id = _basis(ec)
    ec.set_time("2026-10-08T01:00:00Z")
    run = _create(ec).json()
    ec.set_time("2026-10-08T02:00:00Z")
    revision = ec.client.get(f"/api/cards/{card_id}").json()["content_revision"]
    assert (
        ec.client.post(
            "/api/learning/contacts",
            json={
                "submission_id": str(uuid4()),
                "card_id": card_id,
                "revision": revision,
                "source": "words_list",
                "kind": "answer_visible",
            },
        ).status_code
        == 200
    )
    ec.set_time("2026-10-08T03:00:00Z")
    assert _attempt(ec, run).status_code == 200
    backup = ec.client.get("/api/export/backup").json()
    item = backup["extensions"]["practice_items"][0]
    item["retention_result"] = {**item["retention_basis"], "gap_seconds": 612000}
    assert ec.client.post("/api/import/preview", json=backup).status_code == 422


def test_el09_parallel_confirmations_schedule_once(ec):
    from concurrent.futures import ThreadPoolExecutor

    _basis(ec)
    ec.set_time("2026-10-08T01:00:00Z")
    run = _create(ec).json()
    submission_id = str(uuid4())
    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(
            executor.map(
                lambda _: _attempt(ec, run, submission_id=submission_id), range(2)
            )
        )
    assert [response.status_code for response in responses] == [200, 200]
    assert responses[0].json()["event_id"] == responses[1].json()["event_id"]
    stats = ec.client.get("/api/stats").json()["retention"]["week"]
    assert (stats["successes"], stats["count"]) == (1, 1)


def test_el09_pending_session_roundtrip_can_continue_with_remapped_card(ec, ec_factory):
    _basis(ec)
    ec.set_time("2026-10-08T01:00:00Z")
    run = _create(ec).json()
    backup = ec.client.get("/api/export/backup").json()
    target = ec_factory()
    target.seed_card(word="reserved")
    target.set_time("2026-10-08T01:00:00Z")
    preview = target.client.post("/api/import/preview", json=backup)
    assert preview.status_code == 200, preview.text
    restored = target.client.post(
        "/api/import/cards",
        json={
            "backup": backup,
            "expected_revision": preview.json()["expected_revision"],
        },
    )
    assert restored.status_code == 200, restored.text
    resumed = target.client.get(
        "/api/practice-sessions?purpose=delayed_check&window=week"
    )
    assert resumed.status_code == 200, resumed.text
    assert resumed.json()["sessions"][0]["id"] == run["id"]
    pending = target.client.get(f"/api/practice-sessions/{run['id']}").json()
    assert pending["items"][0]["status"] == "pending"
    assert pending["items"][0]["card_id"] != run["items"][0]["card_id"]
    assert _attempt(target, pending).status_code == 200
    assert target.client.get("/api/stats").json()["retention"]["week"]["count"] == 1


def test_el09_old_v3_without_delayed_fields_stays_readable(ec, ec_factory):
    ec.seed_card()
    backup = ec.client.get("/api/export/backup").json()
    target = ec_factory()
    preview = target.client.post("/api/import/preview", json=backup)
    assert preview.status_code == 200
    assert preview.json()["retention_history"] == "not_recorded"
    assert (
        target.client.post(
            "/api/import/cards",
            json={
                "backup": backup,
                "expected_revision": preview.json()["expected_revision"],
            },
        ).status_code
        == 200
    )
    target.set_time("2026-10-08T01:00:00Z")
    assert _create(target).json()["items"] == []
    assert target.client.get("/api/stats").json()["retention"]["week"]["count"] == 0


def test_el09_functional_rollback_preserves_evidence_and_normal_learning(ec):
    card_id = _basis(ec)
    ec.set_time("2026-10-08T01:00:00Z")
    run = _create(ec).json()
    assert _attempt(ec, run).status_code == 200
    before = ec.snapshot()
    ec.settings.delayed_recall_enabled = False
    stats = ec.client.get("/api/stats").json()
    assert stats["delayed_recall_enabled"] is False
    assert stats["retention"]["week"]["count"] == 1
    assert ec.snapshot() == before
    assert ec.client.get(f"/api/practice-sessions/{run['id']}").status_code == 200
    assert (
        ec.client.post(
            "/api/typing/check",
            json={
                "card_id": card_id,
                "user_input": "apple",
                "source": "spelling",
                "submission_id": str(uuid4()),
            },
        ).status_code
        == 200
    )


@pytest.mark.parametrize("stage", ["issued", "submitted"])
def test_el09_advancing_clock_keeps_backup_gap_consistent(ec, monkeypatch, stage):
    _basis(ec)
    ec.set_time("2026-10-08T01:00:00Z")
    base = ec.clock.now()
    ticks = iter(range(100))
    monkeypatch.setattr(ec.clock, "now", lambda: base + timedelta(seconds=next(ticks)))
    run = _create(ec).json()
    if stage == "submitted":
        assert _attempt(ec, run).status_code == 200
    backup = ec.client.get("/api/export/backup").json()
    preview = ec.client.post("/api/import/preview", json=backup)
    assert preview.status_code == 200, preview.text


def test_el09_legacy_wrong_input_is_not_independent_retention_failure(ec):
    card_id = _basis(ec)
    ec.set_time("2026-10-08T01:00:00Z")
    assert _attempt(ec, _create(ec).json()).status_code == 200
    ec.set_time("2026-10-09T01:00:00Z")
    assert (
        ec.client.post(
            "/api/typing/check",
            json={
                "card_id": card_id,
                "user_input": "wrong",
                "submission_id": str(uuid4()),
            },
        ).status_code
        == 200
    )
    assert (
        ec.client.get(f"/api/cards/{card_id}").json()["learning_evidence"]["retention"][
            "status"
        ]
        == "verified"
    )


def test_el09_legacy_input_between_issue_and_submit_keeps_backup_restorable(ec):
    card_id = _basis(ec)
    ec.set_time("2026-10-08T01:00:00Z")
    run = _create(ec).json()
    ec.set_time("2026-10-08T02:00:00Z")
    assert (
        ec.client.post(
            "/api/typing/check",
            json={
                "card_id": card_id,
                "user_input": "apple",
                "submission_id": str(uuid4()),
            },
        ).status_code
        == 200
    )
    ec.set_time("2026-10-08T03:00:00Z")
    result = _attempt(ec, run)
    assert result.status_code == 200
    assert result.json()["session"]["items"][0]["window"] == "other"
    assert result.json()["session"]["items"][0]["gap_seconds"] == 3600
    backup = ec.client.get("/api/export/backup").json()
    preview = ec.client.post("/api/import/preview", json=backup)
    assert preview.status_code == 200, preview.text
