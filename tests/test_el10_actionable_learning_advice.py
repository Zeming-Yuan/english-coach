"""EL-10：公开入口验证建议依据与绑定的真实练习目标。"""

from uuid import uuid4

import pytest


def _answer(ec, card_id, answer="wrong", assistance=None):
    response = ec.client.post(
        "/api/typing/check",
        json={
            "card_id": card_id,
            "user_input": answer,
            "source": "spelling",
            "submission_id": str(uuid4()),
            "assistance": assistance or [],
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_el10_advice_targets_actual_failed_card(ec):
    card_id = ec.seed_card()
    _answer(ec, card_id)
    before = ec.snapshot()
    response = ec.client.get("/api/learning/recommendations")
    assert response.status_code == 200, response.text
    suggestion = response.json()["suggestions"][0]
    assert suggestion["card_ids"] == [card_id]
    assert suggestion["purpose"] == "targeted"
    assert suggestion["reason_kind"] == "failed"
    assert suggestion["kind"] == "typed"
    assert "apple" not in response.text
    assert ec.snapshot() == before


def test_el10_priority_deduplication_limits_and_assisted_only(ec):
    failed = [ec.seed_card(word=f"failure{i}") for i in range(4)]
    assisted = [ec.seed_card(word=f"assisted{i}") for i in range(4)]
    for card_id in failed:
        _answer(ec, card_id)
        _answer(ec, card_id, f"failure{failed.index(card_id)}", ["first_letter"])
    for i, card_id in enumerate(assisted):
        _answer(ec, card_id, f"assisted{i}", ["first_letter"])
    response = ec.client.get("/api/learning/recommendations")
    assert response.status_code == 200
    suggestions = response.json()["suggestions"]
    assert [s["reason_kind"] for s in suggestions] == ["failed", "assisted_only"]
    assert suggestions[0]["card_ids"] == failed[:3]
    assert suggestions[1]["card_ids"] == assisted[:3]
    assert all(len(s["card_ids"]) <= 3 for s in suggestions)


def test_el10_empty_and_recognition_are_not_recall_failure(ec):
    card_id = ec.seed_card()
    data = ec.client.get("/api/learning/recommendations").json()
    assert data["suggestions"] == []
    assert "暂无数据不代表能力不足" in data["message"]
    _answer(ec, card_id, "apple")
    assert ec.client.get("/api/learning/recommendations").json()["suggestions"] == []


def _suggestion(ec):
    return ec.client.get("/api/learning/recommendations").json()["suggestions"][0]


def _start(ec, advice, **extra):
    return ec.client.post(
        "/api/practice-sessions",
        json={
            "id": str(uuid4()),
            "purpose": advice["purpose"],
            "window": advice["window"],
            "targets": advice["targets"],
            "card_ids": advice["card_ids"],
            **extra,
        },
    )


def test_el10_explicit_targeted_practice_binds_revision_and_replays(ec):
    card_id = ec.seed_card()
    ec.seed_card(word="banana")
    _answer(ec, card_id)
    advice = _suggestion(ec)
    identity = str(uuid4())
    response = _start(ec, advice, id=identity)
    assert response.status_code == 200, response.text
    run = response.json()
    assert [item["card_id"] for item in run["items"]] == [card_id]
    assert "apple" not in response.text
    assert run["purpose"] == "targeted"
    assert _start(ec, advice, id=identity).json()["id"] == run["id"]
    result = ec.client.post(
        f"/api/practice-sessions/{run['id']}/items/{run['items'][0]['id']}/attempts",
        json={
            "submission_id": str(uuid4()),
            "answer": "apple",
        },
    )
    assert result.status_code == 200, result.text
    assert result.json()["committed"] is True


def _contact(ec, card_id):
    revision = ec.client.get(f"/api/cards/{card_id}").json()["content_revision"]
    result = ec.client.post(
        "/api/learning/contacts",
        json={
            "submission_id": str(uuid4()),
            "card_id": card_id,
            "revision": revision,
            "source": "card_detail",
            "kind": "answer_visible",
        },
    )
    assert result.status_code == 200


def test_el10_delayed_suggestion_hides_answers_and_binds_eligible_set(ec):
    ec.set_time("2026-10-01T01:00:00Z")
    card_id = ec.seed_card()
    _answer(ec, card_id, "apple")
    _contact(ec, card_id)
    ec.set_time("2026-10-08T01:00:00Z")
    advice = _suggestion(ec)
    assert advice["reason_kind"] == "delayed"
    assert advice["window"] == "week"
    assert advice["card_ids"] == [card_id]
    response = _start(ec, advice)
    assert response.status_code == 200, response.text
    assert [i["card_id"] for i in response.json()["items"]] == [card_id]
    _contact(ec, card_id)
    assert ec.client.get("/api/learning/recommendations").json()["suggestions"] == []
    stale = _start(ec, advice)
    assert stale.status_code == 409, stale.text
    assert "不再符合" in stale.text


def test_el10_targeted_v3_roundtrip_continues_frozen_target(ec_factory):
    source, target = ec_factory(), ec_factory()
    card_id = source.seed_card()
    _answer(source, card_id)
    run = _start(source, _suggestion(source)).json()
    snapshot = source.client.get("/api/export/backup").json()
    preview = target.client.post("/api/import/preview", json=snapshot)
    assert preview.status_code == 200, preview.text
    target.seed_card(word="reserved")
    preview = target.client.post("/api/import/preview", json=snapshot)
    restored = target.client.post(
        "/api/import/cards",
        json={
            "backup": snapshot,
            "expected_revision": preview.json()["expected_revision"],
        },
    )
    assert restored.status_code == 200, restored.text
    pending = target.client.get(f"/api/practice-sessions/{run['id']}").json()
    assert pending["purpose"] == "targeted"
    assert pending["items"][0]["card_id"] != card_id
    result = target.client.post(
        f"/api/practice-sessions/{run['id']}/items/{pending['items'][0]['id']}/attempts",
        json={"submission_id": str(uuid4()), "answer": "apple"},
    )
    assert result.status_code == 200, result.text
    assert result.json()["correct"] is True


def test_el10_course_retention_is_scoped_to_current_lesson_targets(ec):
    from app.models.lesson import Lesson

    ec.set_time("2026-10-01T01:00:00Z")
    card_id = ec.seed_card()
    _answer(ec, card_id, "apple")
    _contact(ec, card_id)
    other = ec.seed_card(word="banana", meaning="香蕉")
    _answer(ec, other, "banana")
    _contact(ec, other)
    with ec.SessionLocal() as db:
        db.add_all(
            [
                Lesson(
                    level=1,
                    title="水果",
                    content={"words": [{"word": "apple", "meaning": "苹果"}]},
                ),
                Lesson(
                    level=2,
                    title="另一课",
                    content={"words": [{"word": "banana", "meaning": "香蕉"}]},
                ),
            ]
        )
        db.commit()
    ec.set_time("2026-10-08T01:00:00Z")
    advice = _suggestion(ec)
    advice = {
        **advice,
        "targets": [t for t in advice["targets"] if t["card_id"] == card_id],
        "card_ids": [card_id],
    }
    run = _start(ec, advice).json()
    result = ec.client.post(
        f"/api/practice-sessions/{run['id']}/items/{run['items'][0]['id']}/attempts",
        json={"submission_id": str(uuid4()), "answer": "apple"},
    )
    assert result.status_code == 200
    lessons = ec.client.get("/api/lessons").json()["lessons"]
    assert lessons[0]["learning_progress"]["retention"]["week"]["count"] == 1
    assert lessons[1]["learning_progress"]["retention"]["week"]["count"] == 0
    detail = ec.client.get("/api/lessons/1").json()
    assert detail["learning_progress"]["retention"]["week"]["successes"] == 1
    assert detail["learning_progress"]["checked_count"] == 0
    assert (
        ec.client.put(f"/api/cards/{card_id}", json={"meaning": "新释义"}).status_code
        == 200
    )
    assert (
        ec.client.get("/api/lessons/1").json()["learning_progress"]["retention"][
            "week"
        ]["count"]
        == 0
    )


def test_el10_old_backup_explains_missing_targeted_history(ec):
    backup = ec.client.get("/api/export/backup").json()
    preview = ec.client.post("/api/import/preview", json=backup)
    assert preview.status_code == 200
    assert preview.json()["targeted_history"] == "not_recorded"


def test_el10_repeated_assistance_never_inflates_independent_sample_count(ec):
    card_id = ec.seed_card()
    for _ in range(10):
        _answer(ec, card_id, "apple", ["first_letter"])
    suggestion = _suggestion(ec)
    assert suggestion["sample_count"] == 0
    assert "样本较少" in suggestion["reason"]


def test_el10_targeted_round_can_be_discovered_after_restore(ec):
    card_id = ec.seed_card()
    _answer(ec, card_id)
    run = _start(ec, _suggestion(ec)).json()
    response = ec.client.get("/api/practice-sessions?purpose=targeted")
    assert response.status_code == 200, response.text
    assert response.json()["sessions"][0]["id"] == run["id"]


def test_el10_target_changes_are_explained_without_substitution(ec):
    card_id = ec.seed_card()
    ec.seed_card(word="banana")
    _answer(ec, card_id)
    advice = _suggestion(ec)
    assert (
        ec.client.put(f"/api/cards/{card_id}", json={"meaning": "新释义"}).status_code
        == 200
    )
    assert _start(ec, advice).status_code == 409
    assert ec.client.delete(f"/api/cards/{card_id}").status_code == 200
    assert _start(ec, advice).status_code == 404
    empty = _start(
        ec, {"purpose": "targeted", "window": None, "targets": [], "card_ids": []}
    )
    assert empty.status_code == 200
    assert empty.json()["items"] == []
    assert "返回建议" in empty.json()["message"]


def test_el10_targeted_failure_rolls_back_and_concurrent_retry_saves_once(ec):
    from concurrent.futures import ThreadPoolExecutor

    card_id = ec.seed_card()
    _answer(ec, card_id)
    advice = _suggestion(ec)
    identity = str(uuid4())
    before = ec.snapshot()
    ec.fail_commit_once()
    assert _start(ec, advice, id=identity).status_code == 500
    assert ec.snapshot() == before
    with ThreadPoolExecutor(max_workers=2) as pool:
        created = list(pool.map(lambda _: _start(ec, advice, id=identity), range(2)))
    assert [r.status_code for r in created] == [200, 200]
    run = created[0].json()
    assert created[1].json() == run
    path = f"/api/practice-sessions/{run['id']}/items/{run['items'][0]['id']}/attempts"
    payload = {"submission_id": str(uuid4()), "answer": "apple"}
    before = ec.snapshot()
    ec.fail_commit_once()
    assert ec.client.post(path, json=payload).status_code == 500
    assert ec.snapshot() == before
    with ThreadPoolExecutor(max_workers=2) as pool:
        saved = list(pool.map(lambda _: ec.client.post(path, json=payload), range(2)))
    assert [r.status_code for r in saved] == [200, 200]
    assert saved[0].json()["event_id"] == saved[1].json()["event_id"]
    assert len(ec.client.get(f"/api/cards/{card_id}").json()["learning_events"]) == 2
    assert (
        ec.client.put(f"/api/cards/{card_id}", json={"meaning": "新释义"}).status_code
        == 200
    )
    assert ec.client.post(path, json=payload).status_code == 200
    assert (
        ec.client.post(
            path, json={**payload, "submission_id": str(uuid4())}
        ).status_code
        == 409
    )
    assert ec.client.post(path, json={**payload, "answer": "other"}).status_code == 409


def test_el10_recognition_error_is_not_an_independent_recall_failure(ec):
    for word in ("apple", "book", "cat", "dog"):
        ec.seed_card(word=word, meaning=word)
    question = ec.client.get("/api/listening?limit=1").json()["questions"][0]
    wrong = next(option for option in question["options"] if option != question["word"])
    saved = ec.client.post(
        "/api/listening/score",
        json={
            "card_id": question["card_id"],
            "answer": wrong,
            "question_token": question["question_token"],
            "source": "listening",
            "kind": "choice",
            "submission_id": str(uuid4()),
        },
    )
    assert saved.status_code == 200, saved.text
    assert ec.client.get("/api/learning/recommendations").json()["suggestions"] == []


def test_el10_rollback_hides_entries_and_keeps_learning_and_v3(ec):
    card_id = ec.seed_card()
    _answer(ec, card_id)
    run = _start(ec, _suggestion(ec)).json()
    before = ec.snapshot()
    ec.settings.learning_advice_enabled = False
    assert ec.client.get("/api/learning/recommendations").json()["enabled"] is False
    assert ec.client.get(f"/api/practice-sessions/{run['id']}").status_code == 200
    assert ec.snapshot() == before
    assert (
        ec.client.get("/api/export/backup").json()["extensions"]["practice_sessions"][
            0
        ]["purpose"]
        == "targeted"
    )


def test_el10_targeted_backup_rejects_inconsistent_scope_without_writes(ec):
    card_id = ec.seed_card()
    _answer(ec, card_id)
    _start(ec, _suggestion(ec))
    backup = ec.client.get("/api/export/backup").json()
    backup["extensions"]["practice_sessions"][0]["window"] = "week"
    before = ec.snapshot()
    assert ec.client.post("/api/import/preview", json=backup).status_code == 422
    assert ec.snapshot() == before


def test_el10_same_word_is_not_recommended_twice_across_card_identities(ec):
    first = ec.seed_card(word="apple")
    second = ec.seed_card(word="Apple")
    _answer(ec, first)
    _answer(ec, second)
    suggestions = ec.client.get("/api/learning/recommendations").json()["suggestions"]
    assert [card_id for s in suggestions for card_id in s["card_ids"]] == [first]


def test_el10_delayed_target_set_replays_even_when_requested_order_differs(ec):
    ec.set_time("2026-10-01T01:00:00Z")
    for word in ("apple", "banana"):
        card_id = ec.seed_card(word=word, meaning="水果")
        _answer(ec, card_id, word)
        _contact(ec, card_id)
    ec.set_time("2026-10-08T01:00:00Z")
    advice = _suggestion(ec)
    advice["targets"].reverse()
    advice["card_ids"].reverse()
    identity = str(uuid4())
    created = _start(ec, advice, id=identity)
    assert created.status_code == 200
    replay = _start(ec, advice, id=identity)
    assert replay.status_code == 200, replay.text
    assert replay.json() == created.json()


def test_el10_delayed_advice_reports_actual_basis_and_sample_count(ec):
    ec.set_time("2026-10-01T01:00:00Z")
    card_id = ec.seed_card()
    _answer(ec, card_id, "apple")
    _contact(ec, card_id)
    event_id = ec.client.get("/api/export/backup").json()["learning_events"][0]["id"]
    ec.set_time("2026-10-08T01:00:00Z")
    advice = _suggestion(ec)
    assert advice["sample_count"] == 1
    assert event_id in advice["event_ids"]


@pytest.mark.parametrize("delayed", [False, True])
def test_el10_partial_target_deletion_invalidates_original_round_and_survives_restore(
    ec, ec_factory, delayed
):
    first = ec.seed_card()
    second = ec.seed_card(word="banana")
    if delayed:
        ec.set_time("2026-10-01T01:00:00Z")
        _answer(ec, first, "apple")
        _answer(ec, second, "banana")
        _contact(ec, first)
        _contact(ec, second)
        ec.set_time("2026-10-08T01:00:00Z")
    else:
        _answer(ec, first)
        _answer(ec, second)
    run = _start(ec, _suggestion(ec)).json()
    assert ec.client.delete(f"/api/cards/{second}").status_code == 200
    remaining = ec.client.get(f"/api/practice-sessions/{run['id']}").json()
    assert remaining["status"] == "unavailable"
    assert "原目标" in remaining["message"]
    path = f"/api/practice-sessions/{run['id']}/items/{remaining['items'][0]['id']}/attempts"
    assert (
        ec.client.post(
            path, json={"submission_id": str(uuid4()), "answer": "apple"}
        ).status_code
        == 422
    )
    backup = ec.client.get("/api/export/backup").json()
    target = ec_factory()
    preview = target.client.post("/api/import/preview", json=backup)
    assert preview.status_code == 200, preview.text
    restored = target.client.post(
        "/api/import/cards",
        json={
            "backup": backup,
            "expected_revision": preview.json()["expected_revision"],
        },
    )
    assert restored.status_code == 200
    assert (
        target.client.get(f"/api/practice-sessions/{run['id']}").json()["status"]
        == "unavailable"
    )


def test_el10_primary_reasons_do_not_hide_other_eligible_delayed_targets(ec):
    ec.set_time("2026-10-01T01:00:00Z")
    failures = [ec.seed_card(word=f"failure{i}", meaning="待巩固词") for i in range(3)]
    assisted = ec.seed_card(word="assisted", meaning="辅助词")
    delayed = ec.seed_card(word="apple", meaning="苹果")
    for card_id in failures:
        _answer(ec, card_id)
        _contact(ec, card_id)
    _answer(ec, assisted, "assisted", ["first_letter"])
    _contact(ec, assisted)
    _answer(ec, delayed, "apple")
    _contact(ec, delayed)
    ec.set_time("2026-10-08T01:00:00Z")
    suggestions = ec.client.get("/api/learning/recommendations").json()["suggestions"]
    assert [s["reason_kind"] for s in suggestions] == [
        "failed",
        "assisted_only",
        "delayed",
    ]
    assert [s["card_ids"] for s in suggestions] == [failures, [assisted], [delayed]]


@pytest.mark.parametrize("mode", ["self_rating", "assisted_incorrect"])
def test_el10_delayed_basis_keeps_event_reference_without_independent_samples(ec, mode):
    ec.set_time("2026-10-01T01:00:00Z")
    card_id = ec.seed_card()
    if mode == "self_rating":
        result = ec.client.post(
            "/api/reviews",
            json={
                "card_id": card_id,
                "rating": 3,
                "source": "study",
                "submission_id": str(uuid4()),
            },
        )
        assert result.status_code == 200
    else:
        _answer(ec, card_id, "wrong", ["first_letter"])
    _contact(ec, card_id)
    event_id = ec.client.get("/api/export/backup").json()["learning_events"][0]["id"]
    ec.set_time("2026-10-08T01:00:00Z")
    advice = _suggestion(ec)
    assert advice["reason_kind"] == "delayed"
    assert advice["sample_count"] == 0
    assert event_id in advice["event_ids"]
