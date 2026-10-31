"""EC-15 public compatibility and serialized submission regressions."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest


def test_old_review_response_remains_usable(ec):
    cid = ec.seed_card()
    response = ec.client.post("/api/reviews", json={"card_id": cid, "rating": 3})
    assert response.status_code == 200
    assert {"card_id", "next_due", "committed", "event_id"} <= response.json().keys()
    for path in (
        "/api/cards",
        f"/api/cards/{cid}",
        "/api/export/cards",
        "/api/export/backup",
        "/api/today",
        "/api/recommended",
        "/api/stats",
        "/api/stats/history",
        "/api/stats/weekly",
    ):
        assert ec.client.get(path).status_code == 200, path
    detail = ec.client.get(f"/api/cards/{cid}").json()
    assert detail["memory_state"]["review_count"] == 1
    assert detail["learning_events"][0]["source"] == "legacy"
    weekly = ec.client.get("/api/stats/weekly").json()
    assert weekly["this_week"] is None
    assert all(week["total"] == 0 for week in weekly["weeks"])


@pytest.mark.parametrize("conflicting", [False, True])
def test_concurrent_submission_serializes_public_state(ec, conflicting):
    cid = ec.seed_card()
    payload = {
        "card_id": cid,
        "rating": 1,
        "source": "study",
        "submission_id": str(uuid4()),
    }
    barrier = Barrier(2)

    def submit(rating):
        barrier.wait(timeout=10)
        return ec.client.post("/api/reviews", json={**payload, "rating": rating})

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(submit, 1)
        second = pool.submit(submit, 3 if conflicting else 1)
        responses = [first.result(timeout=20), second.result(timeout=20)]
    assert sorted(r.status_code for r in responses) == (
        [200, 409] if conflicting else [200, 200]
    )
    saved = next(r.json() for r in responses if r.status_code == 200)
    if not conflicting:
        assert responses[0].json() == responses[1].json()
    detail = ec.client.get(f"/api/cards/{cid}").json()
    assert detail["memory_state"]["review_count"] == 1
    assert len(detail["learning_events"]) == 1
    assert detail["learning_events"][0]["event_id"] == saved["event_id"]
    expected_errors = 1 if detail["learning_events"][0]["self_rating"] == 1 else 0
    assert detail["error_count"] == expected_errors
    backup = ec.client.get("/api/export/backup").json()
    assert len(backup["reviews"]) == len(backup["learning_events"]) == 1


def test_legacy_restore_keeps_one_compatible_current_history_snapshot(ec, ec_factory):
    cid = ec.seed_card()
    assert (
        ec.client.post("/api/reviews", json={"card_id": cid, "rating": 3}).status_code
        == 200
    )
    legacy = ec.client.get("/api/export/cards").json()
    target = ec_factory()
    assert target.client.post("/api/import/cards", json=legacy).status_code == 200
    restored = target.client.get("/api/export/backup").json()
    detail = target.client.get(f"/api/cards/{restored['cards'][0]['id']}").json()
    assert len(detail["review_history"]) == 1
    assert len(restored["review_baselines"]) == 1
    assert detail["learning_events"] == []


def test_restored_selected_archive_not_duplicated_in_legacy_history(ec, ec_factory):
    cid = ec.seed_card()
    assert (
        ec.client.post("/api/reviews", json={"card_id": cid, "rating": 3}).status_code
        == 200
    )
    backup = ec.client.get("/api/export/backup").json()
    current = backup["reviews"][0]
    backup["review_baselines"].append(
        {
            "id": str(uuid4()),
            "card_id": cid,
            "source_review_id": current["id"],
            "source_kind": "contract_archive",
            "raw": dict(current),
            "selected": True,
            "captured_at": "2026-10-30T12:00:00",
            "last_activity": current["last_review"],
            "cumulative_count": current["review_count"],
            "source_fingerprint": "e" * 64,
        }
    )
    target = ec_factory()
    target.seed_card("force-remap")
    preview = target.client.post("/api/import/preview", json=backup)
    assert preview.status_code == 200
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
    restored = target.client.get("/api/export/backup").json()
    new_id = restored["cards"][0]["id"]
    assert new_id != cid
    detail = target.client.get(f"/api/cards/{new_id}").json()
    assert len(detail["review_history"]) == 1
    assert restored["review_baselines"][0]["raw"] == current
