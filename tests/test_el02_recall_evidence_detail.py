"""EL-02：独立作答后的回忆证据摘要。

测试 seam：真实 FastAPI → Alembic 迁移建立的隔离 SQLite。
"""

import copy
from uuid import uuid4

import pytest

from app.services.learning_evidence import recall_status


def _typing(ec, card_id, answer="apple", *, assistance=None, submission_id=None):
    return ec.client.post(
        "/api/typing/check",
        json={
            "card_id": card_id,
            "user_input": answer,
            "source": "spelling",
            "submission_id": submission_id or str(uuid4()),
            "assistance": assistance or [],
        },
    )


def _status(ec, card_id):
    detail = ec.client.get(f"/api/cards/{card_id}").json()
    return detail["learning_evidence"]["recall"]


def _two_days(ec, card_id, *, first="2026-10-01T01:00:00Z", second="2026-10-02T01:00:00Z"):
    for now in (first, second):
        ec.set_time(now)
        assert _typing(ec, card_id).status_code == 200


def _as_v2(payload):
    """把当前 V3 快照降为 V2：旧文件不带新扩展与事件修订关联。"""
    payload = copy.deepcopy(payload)
    payload.pop("features")
    payload.pop("extensions")
    payload["version"] = 2
    for event in payload["learning_events"]:
        event.pop("card_identity", None)
        event.pop("card_revision", None)
    return payload


def test_el02_independent_cross_day_recall(ec):
    card_id = ec.seed_card()
    _two_days(ec, card_id)
    detail = ec.client.get(f"/api/cards/{card_id}").json()
    assert detail["learning_evidence"]["recall"]["status"] == "verified"
    assert detail["learning_evidence"]["rule_version"] == "el02-v1"


@pytest.mark.parametrize(
    "arguments, expected",
    [
        ([2, 86400, True, 0, True], "verified"),
        ([2, 86399, True, 0, True], "insufficient"),
        ([1, 90000, True, 0, True], "insufficient"),
        ([3, 172800, False, 0, True], "weak"),
        ([2, 86400, True, 2592001, True], "stale"),
        ([2, 86400, True, 0, False], "history_incomplete"),
    ],
)
def test_el02_recall_status_matrix(arguments, expected):
    assert recall_status(*arguments) == expected


def test_el02_cross_midnight_under_24h_is_insufficient(ec):
    card_id = ec.seed_card()
    _two_days(
        ec,
        card_id,
        first="2026-10-01T15:30:00Z",
        second="2026-10-02T10:00:00Z",
    )
    evidence = _status(ec, card_id)
    assert evidence["status"] == "insufficient"
    assert evidence["count"] == 2


def test_el02_same_day_retry_does_not_add_a_learning_day(ec):
    card_id = ec.seed_card()
    for now in [
        "2026-10-01T01:00:00Z",
        "2026-10-01T08:00:00Z",
        "2026-10-01T15:00:00Z",
    ]:
        ec.set_time(now)
        assert _typing(ec, card_id).status_code == 200
    evidence = _status(ec, card_id)
    assert evidence["status"] == "insufficient"
    assert evidence["count"] == 1


@pytest.mark.parametrize("first_assisted", [True, False])
def test_el02_first_answer_of_day_must_be_independent(ec, first_assisted):
    card_id = ec.seed_card()
    ec.set_time("2026-10-01T00:30:00Z")
    if first_assisted:
        assert (
            _typing(ec, card_id, assistance=["first_letter"]).status_code == 200
        )
    else:
        assert (
            ec.client.post(
                "/api/typing/check",
                json={
                    "card_id": card_id,
                    "user_input": "",
                    "skipped": True,
                    "source": "spelling",
                    "submission_id": str(uuid4()),
                },
            ).status_code
            == 200
        )
    # 同日稍后独立重试不能把当天变成独立学习日。
    ec.set_time("2026-10-01T05:00:00Z")
    assert _typing(ec, card_id).status_code == 200
    ec.set_time("2026-10-02T05:00:00Z")
    assert _typing(ec, card_id).status_code == 200
    evidence = _status(ec, card_id)
    assert evidence["status"] == "insufficient"
    assert evidence["count"] == 1


def test_el02_recognition_and_baseline_are_not_independent(ec):
    from datetime import UTC, datetime
    from uuid import UUID

    from app.models.review_baseline import ReviewBaseline

    card_id = ec.seed_card(word="apple")
    for word in ["book", "cat", "dog"]:
        ec.seed_card(word=word)
    for now in ["2026-10-01T01:00:00Z", "2026-10-02T01:00:00Z"]:
        ec.set_time(now)
        questions = ec.client.get("/api/listening?limit=4").json()["questions"]
        question = next(row for row in questions if row["card_id"] == card_id)
        assert (
            ec.client.post(
                "/api/listening/score",
                json={
                    "card_id": card_id,
                    "question_token": question["question_token"],
                    "answer": question["word"],
                    "source": "listening",
                    "kind": "choice",
                    "submission_id": str(uuid4()),
                },
            ).status_code
            == 200
        )
    assert _status(ec, card_id)["count"] == 0

    db = ec.SessionLocal()
    try:
        db.add(
            ReviewBaseline(
                id=str(UUID(int=1)),
                card_id=card_id,
                source_review_id=None,
                source_kind="migration",
                raw={},
                selected=False,
                captured_at=datetime(2026, 10, 3, tzinfo=UTC).replace(tzinfo=None),
                last_activity=None,
                cumulative_count=0,
                source_fingerprint="a" * 64,
            )
        )
        db.commit()
    finally:
        db.close()
    assert _status(ec, card_id)["status"] == "history_incomplete"


def test_el02_new_independent_failure_makes_evidence_weak(ec):
    card_id = ec.seed_card()
    _two_days(ec, card_id)
    assert _status(ec, card_id)["status"] == "verified"
    ec.set_time("2026-10-03T01:00:00Z")
    assert _typing(ec, card_id, answer="wrong").status_code == 200
    evidence = _status(ec, card_id)
    assert evidence["status"] == "weak"
    assert evidence["last_verified_at"] is not None


def test_el02_stale_after_thirty_days_keeps_history(ec):
    card_id = ec.seed_card()
    _two_days(ec, card_id)
    ec.set_time("2026-11-15T01:00:00Z")
    evidence = _status(ec, card_id)
    assert evidence["status"] == "stale"
    assert evidence["count"] == 2
    assert evidence["last_verified_at"].startswith("2026-10-02")


def test_el02_assisted_recognition_and_self_rating_are_not_independent(ec):
    card_id = ec.seed_card()
    for now in ["2026-10-01T01:00:00Z", "2026-10-02T01:00:00Z"]:
        ec.set_time(now)
        assert (
            _typing(ec, card_id, assistance=["first_letter"]).status_code == 200
        )
        assert (
            ec.client.post(
                "/api/reviews",
                json={
                    "card_id": card_id,
                    "rating": 4,
                    "source": "study",
                    "submission_id": str(uuid4()),
                },
            ).status_code
            == 200
        )
    evidence = _status(ec, card_id)
    assert evidence["status"] == "insufficient"
    assert evidence["count"] == 0


def test_el02_three_failures_are_not_mastery(ec):
    card_id = ec.seed_card()
    for day in ["2026-10-01", "2026-10-02", "2026-10-03"]:
        ec.set_time(f"{day}T01:00:00Z")
        assert _typing(ec, card_id, answer="wrong").status_code == 200
    detail = ec.client.get(f"/api/cards/{card_id}").json()
    evidence = detail["learning_evidence"]["recall"]
    assert evidence["status"] == "weak"
    assert "掌握" not in str(evidence)


def test_el02_content_edit_makes_old_evidence_history(ec):
    card_id = ec.seed_card(meaning="苹果")
    _two_days(ec, card_id)
    assert _status(ec, card_id)["status"] == "verified"
    edited = ec.client.put(f"/api/cards/{card_id}", json={"meaning": "一个苹果"})
    assert edited.status_code == 200
    detail = ec.client.get(f"/api/cards/{card_id}").json()
    evidence = detail["learning_evidence"]
    assert evidence["revision"]["version"] == 2
    assert evidence["revision"]["identity"] == detail["content_revision"]["identity"]
    assert evidence["recall"]["status"] == "insufficient"
    assert evidence["recall"]["count"] == 0
    # 旧事件仍保留在历史中，不被删除或改写。
    assert len(detail["learning_events"]) == 2


def test_el02_detail_keeps_fsrs_due_and_graduation_unlock(ec):
    from datetime import UTC, datetime

    from app.models.review import Review

    card_id = ec.seed_card()
    db = ec.SessionLocal()
    try:
        db.add(
            Review(
                card_id=card_id,
                state=2,
                step=0,
                due=datetime(2026, 10, 30, tzinfo=UTC).replace(tzinfo=None),
                stability=3,
                difficulty=5,
                elapsed_days=1,
                review_count=3,
            )
        )
        db.commit()
    finally:
        db.close()
    detail = ec.client.get(f"/api/cards/{card_id}").json()
    assert detail["graduated"] is True
    assert detail["next_due"] is not None
    assert detail["learning_evidence"]["recall"]["status"] == "insufficient"


def test_el02_commit_failure_and_replay_do_not_duplicate_evidence(ec):
    card_id = ec.seed_card()
    ec.set_time("2026-10-01T01:00:00Z")
    submission_id = str(uuid4())
    payload = {
        "card_id": card_id,
        "user_input": "apple",
        "source": "spelling",
        "submission_id": submission_id,
        "assistance": [],
    }
    before = ec.snapshot()
    ec.fail_commit_once()
    assert ec.client.post("/api/typing/check", json=payload).status_code == 500
    assert ec.snapshot() == before

    saved = ec.client.post("/api/typing/check", json=payload)
    assert saved.status_code == 200
    after = ec.snapshot()
    replay = ec.client.post("/api/typing/check", json=payload)
    assert replay.status_code == 200
    assert ec.snapshot() == after
    assert len(
        [
            row
            for row in after["learning_events"]
            if row["submission_id"] == submission_id
        ]
    ) == 1
    assert after["learning_events"][0]["card_revision"] == 1
    assert after["learning_events"][0]["card_identity"]


@pytest.mark.parametrize("mutation", ["missing-pair", "bad-identity"])
def test_el02_v3_invalid_event_links_rejected(ec, ec_factory, mutation):
    source = ec_factory()
    card_id = source.seed_card()
    source.set_time("2026-10-01T01:00:00Z")
    assert _typing(source, card_id).status_code == 200
    backup = source.client.get("/api/export/backup").json()
    event = backup["learning_events"][0]
    if mutation == "missing-pair":
        event["card_identity"] = None
    else:
        event["card_identity"] = "not-a-uuid"

    target = ec_factory()
    target.seed_card("keep")
    untouched = target.snapshot()
    preview = target.client.post("/api/import/preview", json=backup)
    assert preview.status_code == 422
    assert target.snapshot() == untouched
    confirmed = target.client.post(
        "/api/import/cards",
        json={"backup": backup, "expected_revision": "irrelevant"},
    )
    assert confirmed.status_code == 422
    assert target.snapshot() == untouched


def test_el02_stale_question_creates_no_evidence(ec):
    card_id = ec.seed_card(word="apple")
    for word in ["book", "cat", "dog"]:
        ec.seed_card(word=word)
    question = ec.client.get("/api/listening?limit=4").json()["questions"]
    row = next(item for item in question if item["card_id"] == card_id)
    assert (
        ec.client.put(f"/api/cards/{card_id}", json={"meaning": "一个苹果"}).status_code
        == 200
    )
    response = ec.client.post(
        "/api/listening/score",
        json={
            "card_id": card_id,
            "question_token": row["question_token"],
            "answer": row["word"],
            "source": "listening",
            "kind": "choice",
            "submission_id": str(uuid4()),
        },
    )
    assert response.status_code == 409
    assert _status(ec, card_id)["count"] == 0


def test_el02_v3_restore_preserves_revision_links_and_evidence(ec, ec_factory):
    source = ec_factory()
    card_id = source.seed_card()
    _two_days(source, card_id)
    backup = source.client.get("/api/export/backup").json()
    linked = {
        (row["card_identity"], row["card_revision"])
        for row in backup["learning_events"]
    }
    assert linked == {(backup["extensions"]["content_revisions"][0]["identity"], 1)}

    target = ec_factory()
    preview = target.client.post("/api/import/preview", json=backup)
    assert preview.status_code == 200, preview.text
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
    card = next(row for row in restored["cards"] if row["word"] == "apple")
    detail = target.client.get(f"/api/cards/{card['id']}").json()
    assert detail["learning_evidence"]["recall"]["status"] == "verified"
    assert {
        (row["card_identity"], row["card_revision"])
        for row in restored["learning_events"]
    } == linked


def test_el02_v2_restore_reports_history_incomplete(ec, ec_factory):
    source = ec_factory()
    card_id = source.seed_card()
    _two_days(source, card_id)
    v2 = _as_v2(source.client.get("/api/export/backup").json())

    target = ec_factory()
    preview = target.client.post("/api/import/preview", json=v2)
    assert preview.status_code == 200, preview.text
    assert (
        target.client.post(
            "/api/import/cards",
            json={
                "backup": v2,
                "expected_revision": preview.json()["expected_revision"],
            },
        ).status_code
        == 200
    )
    restored = target.client.get("/api/export/backup").json()
    card = next(row for row in restored["cards"] if row["word"] == "apple")
    detail = target.client.get(f"/api/cards/{card['id']}").json()
    assert detail["learning_evidence"]["recall"]["status"] == "history_incomplete"
    assert all(
        row["card_identity"] is None and row["card_revision"] is None
        for row in restored["learning_events"]
    )
