"""Personal workload calibration through the migrated public application."""

from uuid import uuid4


def saved_attempt(ec, card_id=None, rating=3):
    card_id = card_id or ec.seed_card()
    submission_id = str(uuid4())
    response = ec.client.post(
        "/api/reviews",
        json={
            "card_id": card_id,
            "rating": rating,
            "source": "study",
            "kind": "self_rating",
            "submission_id": submission_id,
        },
    )
    assert response.status_code == 200
    return submission_id


def duration(submission_id, active_ms=12000, kind="new"):
    return {
        "sample_id": str(uuid4()),
        "submission_id": submission_id,
        "kind": kind,
        "active_ms": active_ms,
    }


def test_el18_duration_links_one_saved_attempt(ec):
    payload = duration(saved_attempt(ec))
    before = ec.client.get("/api/export/backup").json()
    response = ec.client.post("/api/learning/durations", json=payload)
    assert response.status_code == 200
    assert response.json() == {"committed": True, "sample_id": payload["sample_id"]}
    assert (
        ec.client.post("/api/learning/durations", json=payload).json()
        == response.json()
    )
    after = ec.client.get("/api/export/backup").json()
    assert len(after["extensions"]["practice_durations"]) == 1
    assert after["learning_events"] == before["learning_events"]
    assert after["reviews"] == before["reviews"]


def test_el18_five_same_kind_samples_calibrate_only_future_previews(ec):
    ids = [ec.seed_card(word=f"word{i}") for i in range(15)]
    for index, seconds in enumerate([6, 8, 10, 12, 100]):
        payload = duration(saved_attempt(ec, ids[index]), seconds * 1000)
        assert (
            ec.client.post("/api/learning/durations", json=payload).status_code == 200
        )
        plan = ec.client.get("/api/today?budget_minutes=3").json()["plan"]
        assert plan["estimate_basis"] == ("personal" if index == 4 else "default")
    data = ec.client.get("/api/today?budget_minutes=3").json()
    assert (
        data["new_count"] == 5
    )  # Today's remaining quota, at ten seconds per new word.
    assert data["plan"]["estimated_seconds"] == 125
    assert data["plan"]["estimates"]["new"] == {
        "seconds": 10,
        "basis": "personal",
        "sample_count": 5,
    }
    assert data["plan"]["estimates"]["review"]["basis"] == "default"


def test_el18_v3_rejects_orphan_and_misclassified_duration_before_restore(ec):
    from copy import deepcopy

    payload = duration(saved_attempt(ec))
    assert ec.client.post("/api/learning/durations", json=payload).status_code == 200
    snapshot = ec.snapshot()
    for field, value in [("submission_id", str(uuid4())), ("kind", "review")]:
        corrupted = deepcopy(ec.client.get("/api/export/backup").json())
        corrupted["extensions"]["practice_durations"][0][field] = value
        response = ec.client.post("/api/import/preview", json=corrupted)
        assert response.status_code == 422, response.text
        assert "practice_durations" in response.text
        assert ec.snapshot() == snapshot


def test_el18_deleted_card_removes_duration_and_rejects_late_sample(ec):
    card_id = ec.seed_card()
    payload = duration(saved_attempt(ec, card_id))
    assert ec.client.post("/api/learning/durations", json=payload).status_code == 200
    assert ec.client.delete(f"/api/cards/{card_id}").status_code == 200
    assert (
        ec.client.get("/api/export/backup").json()["extensions"]["practice_durations"]
        == []
    )
    assert ec.client.post("/api/learning/durations", json=payload).status_code == 404


def test_el18_slow_estimate_still_offers_one_real_card_with_overtime_notice(ec):
    for i in range(5):
        payload = duration(saved_attempt(ec, ec.seed_card(word=f"slow{i}")), 200000)
        assert (
            ec.client.post("/api/learning/durations", json=payload).status_code == 200
        )
    ec.seed_card(word="remaining")
    data = ec.client.get("/api/today?budget_minutes=3").json()
    assert data["target"] == 1
    assert data["plan"]["may_exceed_budget"] is True


def test_el18_rules_use_last_thirty_finite_nonnegative_samples():
    from app.services.time_budget import estimate_seconds

    assert estimate_seconds([], 20) == 20
    assert estimate_seconds([3, 4, 5, 6], 20) == 20
    assert estimate_seconds([3, 4, 5, 6, 7], 20) == 5
    assert estimate_seconds([1] * 5, 20) == 2
    assert estimate_seconds([200] * 5, 20) == 180
    assert estimate_seconds([100.0] * 30 + [10.0] * 30, 20) == 10
    assert estimate_seconds([float("nan"), float("inf"), -1, 3, 4, 5, 6], 20) == 20


def test_el18_invalid_unknown_and_wrong_kind_samples_do_not_write(ec):
    payload = duration(saved_attempt(ec))
    before = ec.snapshot()
    for change, code in [
        ({"active_ms": -1}, 422),
        ({"active_ms": 1.5}, 422),
        ({"active_ms": "12000"}, 422),
        ({"active_ms": True}, 422),
        ({"active_ms": 9007199254740992}, 422),
        ({"kind": "review"}, 422),
        ({"kind": "reinforcement"}, 422),
        ({"rating": 4}, 422),
        ({"submission_id": str(uuid4())}, 404),
    ]:
        assert (
            ec.client.post(
                "/api/learning/durations", json={**payload, **change}
            ).status_code
            == code
        )
        assert ec.snapshot() == before


def test_el18_commit_failure_retry_conflict_and_concurrency(ec):
    from concurrent.futures import ThreadPoolExecutor

    payload = duration(saved_attempt(ec))
    before = ec.snapshot()
    ec.fail_commit_once()
    assert ec.client.post("/api/learning/durations", json=payload).status_code == 500
    assert ec.snapshot() == before
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(
                lambda _: ec.client.post("/api/learning/durations", json=payload),
                range(2),
            )
        )
    assert [r.status_code for r in responses] == [200, 200]
    assert responses[0].json() == responses[1].json()
    after = ec.snapshot()
    for change in [
        {"active_ms": 13000},
        {"sample_id": str(uuid4())},
        {"submission_id": str(uuid4())},
    ]:
        assert (
            ec.client.post(
                "/api/learning/durations", json={**payload, **change}
            ).status_code
            == 409
        )
    assert ec.snapshot() == after
    assert after["learning_events"] == before["learning_events"]
    assert after["reviews"] == before["reviews"]


def restore(ec, backup):
    preview = ec.client.post("/api/import/preview", json=backup)
    assert preview.status_code == 200, preview.text
    response = ec.client.post(
        "/api/import/cards",
        json={
            "backup": backup,
            "expected_revision": preview.json()["expected_revision"],
        },
    )
    assert response.status_code == 200, response.text
    return preview.json()


def test_el18_v3_restore_preserves_rule_order_links_and_replay_after_revision(
    ec, ec_factory
):
    payload = None
    for i in range(5):
        payload = duration(
            saved_attempt(ec, ec.seed_card(word=f"sample{i}")), (i + 8) * 1000
        )
        assert (
            ec.client.post("/api/learning/durations", json=payload).status_code == 200
        )
    assert payload is not None
    backup = ec.client.get("/api/export/backup").json()
    other = ec_factory()
    other.seed_card(word="unrelated")
    restore(other, backup)
    rows = other.client.get("/api/export/backup").json()["extensions"][
        "practice_durations"
    ]
    assert [{k: v for k, v in row.items() if k != "id"} for row in rows] == [
        {k: v for k, v in row.items() if k != "id"}
        for row in backup["extensions"]["practice_durations"]
    ]
    plan = other.client.get("/api/today").json()["plan"]
    assert plan["estimates"]["new"] == {
        "seconds": 10,
        "basis": "personal",
        "sample_count": 5,
    }
    card = other.client.get("/api/cards").json()["cards"][-1]
    assert (
        other.client.put(
            f"/api/cards/{card['id']}", json={"meaning": "修订后"}
        ).status_code
        == 200
    )
    assert other.client.post("/api/learning/durations", json=payload).status_code == 200
    assert (
        len(
            other.client.get("/api/export/backup").json()["extensions"][
                "practice_durations"
            ]
        )
        == 5
    )
    # Functional rollback retains records, saved evidence and schedules.
    before = other.snapshot()
    other.app.state.settings = other.settings.model_copy(
        update={"personal_estimates_enabled": False}
    )
    plan = other.client.get("/api/today").json()["plan"]
    assert plan["estimate_basis"] == "default"
    assert plan["estimates"]["new"]["seconds"] == 40
    assert other.snapshot() == before


def test_el18_older_v3_missing_durations_explains_default_and_atomic_replacement(ec):
    payload = duration(saved_attempt(ec))
    assert ec.client.post("/api/learning/durations", json=payload).status_code == 200
    backup = ec.client.get("/api/export/backup").json()
    backup["features"].remove("practice_durations")
    del backup["extensions"]["practice_durations"]
    preview = ec.client.post("/api/import/preview", json=backup)
    assert preview.status_code == 200
    assert "practice_durations" in preview.json()["extensions"]["missing"]
    before = ec.snapshot()
    ec.fail_commit_once()
    assert (
        ec.client.post(
            "/api/import/cards",
            json={
                "backup": backup,
                "expected_revision": preview.json()["expected_revision"],
            },
        ).status_code
        == 500
    )
    assert ec.snapshot() == before
    restore(ec, backup)
    assert ec.client.get("/api/today").json()["plan"]["estimate_basis"] == "default"
    assert (
        ec.client.get("/api/export/backup").json()["extensions"]["practice_durations"]
        == []
    )


def test_el18_review_and_reinforcement_are_separate_real_attempts(ec):
    card_id = ec.seed_card()
    saved_attempt(ec, card_id, rating=1)
    review_id = saved_attempt(ec, card_id)
    assert (
        ec.client.post(
            "/api/learning/durations", json=duration(review_id, kind="review")
        ).status_code
        == 200
    )
    submission_id = str(uuid4())
    result = ec.client.post(
        "/api/typing/check",
        json={
            "card_id": card_id,
            "kind": "typed",
            "source": "reinforcement",
            "stage": "reinforcement",
            "session_id": str(uuid4()),
            "user_input": "apple",
            "submission_id": submission_id,
        },
    )
    assert result.status_code == 200
    assert (
        ec.client.post(
            "/api/learning/durations",
            json=duration(submission_id, kind="reinforcement"),
        ).status_code
        == 200
    )
    plan = ec.client.get("/api/today").json()["plan"]
    assert plan["estimates"]["review"]["sample_count"] == 1
    assert plan["estimates"]["reinforcement"]["sample_count"] == 1
    assert plan["estimates"]["new"]["sample_count"] == 0


def test_el18_http_preview_uses_latest_thirty_same_kind_samples(ec):
    card_id = ec.seed_card()
    saved_attempt(ec, card_id)
    for index in range(35):
        payload = duration(
            saved_attempt(ec, card_id), 100000 if index < 5 else 12000, kind="review"
        )
        assert (
            ec.client.post("/api/learning/durations", json=payload).status_code == 200
        )
    estimate = ec.client.get("/api/today").json()["plan"]["estimates"]
    assert estimate["review"] == {
        "seconds": 12,
        "basis": "personal",
        "sample_count": 30,
    }
    assert estimate["new"]["basis"] == "default"


def test_el18_v2_missing_durations_restores_with_defaults(ec, ec_factory):
    saved_attempt(ec)
    backup = ec.client.get("/api/export/backup").json()
    backup["version"] = 2
    backup.pop("features")
    backup.pop("extensions")
    for event in backup["learning_events"]:
        event.pop("card_identity", None)
        event.pop("card_revision", None)
    other = ec_factory()
    preview = restore(other, backup)
    assert "practice_durations" in preview["extensions"]["missing"]
    assert other.client.get("/api/today").json()["plan"]["estimate_basis"] == "default"
    assert len(other.client.get("/api/export/backup").json()["learning_events"]) == 1
