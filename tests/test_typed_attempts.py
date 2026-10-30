"""EC-05 输入题一次提交：判分、事件、错词与必要排期同事务保存。

覆盖 Review Focus：
RF1 长度/首字母提示使独立题降级为辅助（不排期）；
RF2 逐字反馈或答案朗读同样不冒充独立掌握；
RF3 空答案按答错，只有显式跳过才 correct=null；
RF4 normalize 保留有效连字符/撇号；
RF5 失败重试/重复请求只产生一条事件。
"""

from uuid import uuid4

import pytest


def _payload(card_id: int, user_input: str = "apple", **overrides) -> dict:
    payload = {
        "card_id": card_id,
        "user_input": user_input,
        "source": "spelling",
        "kind": "typed",
        "assistance": [],
        "submission_id": str(uuid4()),
    }
    payload.update(overrides)
    return payload


def test_independent_typing_saves_once(ec):
    cid = ec.seed_card()
    payload = {
        "card_id": cid,
        "answer": "Apple",
        "user_input": "Apple",
        "source": "spelling",
        "kind": "typed",
        "assistance": [],
        "submission_id": str(uuid4()),
    }
    first = ec.client.post("/api/typing/check", json=payload)
    again = ec.client.post("/api/typing/check", json=payload)
    assert first.status_code == again.status_code == 200
    assert first.json()["scheduled"] is True
    assert first.json()["correct"] is True
    assert first.json()["expected"] == "apple"
    assert first.json()["normalized_answer"] == "apple"
    assert first.json()["event_id"] == again.json()["event_id"]

    detail = ec.client.get(f"/api/cards/{cid}").json()
    assert len(detail["learning_events"]) == 1
    event = detail["learning_events"][0]
    assert event["source"] == "spelling"
    assert event["kind"] == "typed"
    assert event["correct"] is True
    assert event["scheduled"] is True
    assert event["fsrs_rating"] == 3


@pytest.mark.parametrize(
    ("answer", "assistance", "skipped", "correct", "scheduled"),
    [
        ("apple", [], False, True, True),
        ("appl", [], False, False, True),
        ("apple", ["length"], False, True, False),
        ("apple", ["live_feedback", "answer_audio"], False, True, False),
        ("", [], True, None, False),
    ],
)
def test_typed_review_focus(ec, answer, assistance, skipped, correct, scheduled):
    cid = ec.seed_card()
    response = ec.client.post(
        "/api/typing/check",
        json=_payload(
            cid,
            answer,
            assistance=assistance,
            skipped=skipped,
        ),
    )
    assert response.status_code == 200
    assert response.json()["correct"] is correct
    assert response.json()["scheduled"] is scheduled

    event = ec.client.get(f"/api/cards/{cid}").json()["learning_events"][0]
    assert event["correct"] is correct
    assert event["scheduled"] is scheduled
    assert event["skipped"] is skipped
    if scheduled:
        assert event["fsrs_rating"] == (3 if correct else 1)
    else:
        assert event["fsrs_rating"] is None
    if skipped:
        assert event["answer"] is None


def test_empty_answer_is_wrong_not_skip(ec):
    cid = ec.seed_card()
    response = ec.client.post("/api/typing/check", json=_payload(cid, ""))
    assert response.status_code == 200
    assert response.json()["correct"] is False
    assert response.json()["scheduled"] is True

    event = ec.client.get(f"/api/cards/{cid}").json()["learning_events"][0]
    assert event["skipped"] is False
    assert event["correct"] is False
    assert event["fsrs_rating"] == 1


def test_assisted_correct_never_schedules(ec):
    cid = ec.seed_card()
    response = ec.client.post(
        "/api/typing/check", json=_payload(cid, "apple", assistance=["first_letter"])
    )
    assert response.status_code == 200
    assert response.json()["correct"] is True
    assert response.json()["scheduled"] is False

    detail = ec.client.get(f"/api/cards/{cid}").json()
    assert detail["memory_state"] is None
    assert detail["learning_events"][0]["assistance"] == ["first_letter"]


def test_skip_records_null_without_error_weight(ec):
    cid = ec.seed_card()
    response = ec.client.post("/api/typing/check", json=_payload(cid, "", skipped=True))
    assert response.status_code == 200
    assert response.json()["correct"] is None
    assert response.json()["scheduled"] is False
    assert response.json()["expected"] == "apple"

    detail = ec.client.get(f"/api/cards/{cid}").json()
    assert detail["error_count"] == 0
    assert detail["memory_state"] is None
    event = detail["learning_events"][0]
    assert event["correct"] is None
    assert event["skipped"] is True


def test_normalization_keeps_apostrophe_and_hyphen(ec):
    apostrophe = ec.seed_card("can't")
    hyphen = ec.seed_card("well-known")
    assert (
        ec.client.post("/api/typing/check", json=_payload(apostrophe, "Can't,"))
        .json()["correct"]
        is True
    )
    assert (
        ec.client.post("/api/typing/check", json=_payload(hyphen, "Well-Known!"))
        .json()["correct"]
        is True
    )


def test_same_submission_with_different_answer_conflicts(ec):
    cid = ec.seed_card()
    payload = _payload(cid, "apple")
    assert ec.client.post("/api/typing/check", json=payload).status_code == 200

    conflict = ec.client.post(
        "/api/typing/check", json={**payload, "user_input": "appl"}
    )
    assert conflict.status_code == 409
    detail = ec.client.get(f"/api/cards/{cid}").json()
    assert len(detail["learning_events"]) == 1
    assert detail["memory_state"]["review_count"] == 1


def test_unknown_card_and_invalid_assistance(ec):
    missing = ec.client.post("/api/typing/check", json=_payload(999, "apple"))
    assert missing.status_code == 404

    cid = ec.seed_card()
    invalid = ec.client.post(
        "/api/typing/check",
        json=_payload(cid, "apple", assistance=["unknown_hint"]),
    )
    assert invalid.status_code == 422
    assert ec.client.get(f"/api/cards/{cid}").json()["learning_events"] == []


def test_legacy_request_stays_unclassified_and_unscheduled(ec):
    cid = ec.seed_card()
    response = ec.client.post(
        "/api/typing/check", json={"card_id": cid, "user_input": "apple"}
    )
    assert response.status_code == 200
    assert response.json()["correct"] is True
    assert response.json()["scheduled"] is False

    detail = ec.client.get(f"/api/cards/{cid}").json()
    assert detail["memory_state"] is None
    assert detail["history_incomplete"] is True
    event = detail["learning_events"][0]
    assert event["source"] == "legacy"
    assert event["scheduled"] is False


def test_failed_commit_rolls_back_then_retry_saves_once(ec):
    cid = ec.seed_card()
    payload = _payload(cid, "apple")
    ec.fail_commit_once()
    failed = ec.client.post("/api/typing/check", json=payload)
    assert failed.status_code == 500
    assert "committed" not in failed.json()

    untouched = ec.client.get(f"/api/cards/{cid}").json()
    assert untouched["learning_events"] == []
    assert untouched["memory_state"] is None
    assert untouched["error_count"] == 0

    retried = ec.client.post("/api/typing/check", json=payload)
    assert retried.status_code == 200
    detail = ec.client.get(f"/api/cards/{cid}").json()
    assert len(detail["learning_events"]) == 1
    assert detail["memory_state"]["review_count"] == 1
