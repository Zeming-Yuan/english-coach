"""EL-08：课程三题短测、持久练习上下文与首答结果。

测试 seam：真实 FastAPI → Alembic 迁移建立的隔离 SQLite。
结果只关联真实学习事件；未作答题目不返回答案、长度或音频。
"""

from uuid import uuid4

import pytest

from app.models.lesson import Lesson
from app.services.practice import lesson_check_status


def _seed_lesson(ec, words, *, level=1):
    ids = {}
    for word in words:
        ids[word] = ec.seed_card(word=word, meaning=f"{word}的意思")
    with ec.SessionLocal() as db:
        lesson = Lesson(
            level=level,
            title="水果",
            content={
                "words": [
                    {"word": word, "meaning": f"{word}的意思"} for word in words
                ],
                "dialogue": [],
                "tips": [],
            },
        )
        db.add(lesson)
        db.commit()
        lesson_id = lesson.id
    return lesson_id, ids


def _create(ec, lesson_id, *, weak_only=False, session_id=None):
    return ec.client.post(
        "/api/practice-sessions",
        json={
            "id": session_id or str(uuid4()),
            "purpose": "lesson_check",
            "lesson_id": lesson_id,
            "weak_only": weak_only,
        },
    )


def _attempt(
    ec, session, *, answer="apple", skipped=False, submission_id=None, index=0
):
    item = session["items"][index]
    return ec.client.post(
        f"/api/practice-sessions/{session['id']}/items/{item['id']}/attempts",
        json={
            "submission_id": submission_id or str(uuid4()),
            "answer": None if skipped else answer,
            "skipped": skipped,
        },
    )


def _assist(ec, session, kind="first_letter", index=0):
    item = session["items"][index]
    return ec.client.post(
        f"/api/practice-sessions/{session['id']}/items/{item['id']}/assistance",
        json={"kind": kind},
    )


@pytest.mark.parametrize(
    "arguments, expected",
    [
        ([[]], "unavailable"),
        ([[{"processed": False}]], "incomplete"),
        ([[{"processed": True, "correct": True, "assistance": []}]], "passed"),
        (
            [[{"processed": True, "correct": True, "assistance": ["first_letter"]}]],
            "weak",
        ),
        ([[{"processed": True, "skipped": True, "correct": None}]], "incomplete"),
    ],
)
def test_el08_review_focus(arguments, expected):
    assert lesson_check_status(*arguments) == expected


def test_el08_lesson_check_has_persistent_items(ec):
    lesson_id, ids = _seed_lesson(ec, ["apple"])
    response = _create(ec, lesson_id)
    assert response.status_code == 200, response.text
    run = response.json()
    assert run["purpose"] == "lesson_check"
    assert run["status"] == "incomplete"
    assert len(run["items"]) == 1
    assert run["items"][0]["card_id"] == ids["apple"]
    assert "expected" not in run["items"][0]
    assert "word" not in run["items"][0]
    assert ec.client.get(f"/api/practice-sessions/{run['id']}").status_code == 200


def test_el08_up_to_three_distinct_words_and_less(ec):
    lesson_id, _ = _seed_lesson(ec, ["apple", "book", "cat", "dog"])
    run = _create(ec, lesson_id).json()
    assert len(run["items"]) == 3
    assert len({item["card_id"] for item in run["items"]}) == 3
    level_two, _ = _seed_lesson(ec, ["apple", "book"], level=2)
    assert len(_create(ec, level_two).json()["items"]) == 2


def test_el08_zero_words_is_explicitly_unavailable(ec):
    lesson_id, _ = _seed_lesson(ec, [], level=3)
    run = _create(ec, lesson_id).json()
    assert run["status"] == "unavailable"
    assert run["items"] == []
    assert run["message"]


def test_el08_all_correct_without_help_passes(ec):
    lesson_id, ids = _seed_lesson(ec, ["apple", "book", "cat"])
    run = _create(ec, lesson_id).json()
    for item in run["items"]:
        word = next(word for word, cid in ids.items() if cid == item["card_id"])
        saved = _attempt(ec, run, answer=word, index=item["position"] - 1)
        assert saved.status_code == 200, saved.text
        run = saved.json()["session"]
    assert run["status"] == "passed"
    assert run["lifecycle"] == "completed"
    assert run["counts"]["passed"] == 3
    detail = ec.client.get("/api/lessons/1").json()
    assert detail["learning_progress"]["status"] == "passed"
    assert detail["learning_progress"]["checked_count"] == 3
    assert detail["learning_progress"]["passed_count"] == 3
    event = ec.client.get(f"/api/cards/{ids['apple']}").json()["learning_events"][0]
    assert event["source"] == "lesson"
    assert event["kind"] == "typed"
    assert event["self_rating"] is None
    assert event["assistance"] == []


def test_el08_assisted_correct_is_weak(ec):
    lesson_id, ids = _seed_lesson(ec, ["apple"])
    run = _create(ec, lesson_id).json()
    helped = _assist(ec, run)
    assert helped.status_code == 200, helped.text
    assert helped.json()["items"][0]["assistance"] == ["first_letter"]
    assert helped.json()["items"][0]["hint"]["value"] == "a"
    run = helped.json()
    saved = _attempt(ec, run, answer="apple")
    assert saved.status_code == 200
    session = saved.json()["session"]
    assert session["status"] == "weak"
    assert session["counts"]["passed"] == 0
    detail = ec.client.get("/api/lessons/1").json()
    assert detail["learning_progress"]["status"] == "weak"
    assert detail["learning_progress"]["passed_count"] == 0
    event = ec.client.get(f"/api/cards/{ids['apple']}").json()["learning_events"][0]
    assert event["assistance"] == ["first_letter"]
    assert event["scheduled"] is False


def test_el08_wrong_then_retry_keeps_first_result(ec):
    lesson_id, ids = _seed_lesson(ec, ["apple"])
    run = _create(ec, lesson_id).json()
    first = _attempt(ec, run, answer="wrong")
    assert first.status_code == 200, first.text
    session = first.json()["session"]
    assert session["status"] == "weak"
    assert session["items"][0]["correct"] is False
    retry = _attempt(ec, run, answer="apple")
    assert retry.status_code == 200, retry.text
    retried = retry.json()["session"]
    assert retried["status"] == "weak"
    assert retried["items"][0]["correct"] is False
    events = ec.client.get(f"/api/cards/{ids['apple']}").json()["learning_events"]
    assert len(events) == 2
    assert (
        ec.client.get("/api/lessons/1").json()["learning_progress"]["passed_count"]
        == 0
    )


def test_el08_skip_is_not_wrong_or_passed(ec):
    lesson_id, _ = _seed_lesson(ec, ["apple"])
    run = _create(ec, lesson_id).json()
    saved = _attempt(ec, run, skipped=True)
    assert saved.status_code == 200, saved.text
    result = saved.json()
    assert result["correct"] is None
    assert result["skipped"] is True
    session = result["session"]
    assert session["items"][0]["status"] == "skipped"
    assert session["status"] == "incomplete"
    assert session["counts"]["passed"] == 0
    detail = ec.client.get("/api/lessons/1").json()
    assert detail["learning_progress"]["status"] == "unrecorded"
    assert detail["learning_progress"]["passed_count"] == 0


def test_el08_same_submission_replays_once_and_rejects_different_content(ec):
    lesson_id, ids = _seed_lesson(ec, ["apple"])
    run = _create(ec, lesson_id).json()
    submission_id = str(uuid4())
    first = _attempt(ec, run, answer="apple", submission_id=submission_id)
    assert first.status_code == 200
    replay = _attempt(ec, run, answer="apple", submission_id=submission_id)
    assert replay.status_code == 200
    assert replay.json()["event_id"] == first.json()["event_id"]
    conflict = _attempt(ec, run, answer="wrong", submission_id=submission_id)
    assert conflict.status_code == 409
    assert len(ec.client.get(f"/api/cards/{ids['apple']}").json()["learning_events"]) == 1


def test_el08_assistance_and_revision_conflict(ec):
    lesson_id, ids = _seed_lesson(ec, ["apple"])
    run = _create(ec, lesson_id).json()
    assert (
        ec.client.put(
            f"/api/cards/{ids['apple']}", json={"meaning": "新苹果"}
        ).status_code
        == 200
    )
    stale = _attempt(ec, run, answer="apple")
    assert stale.status_code == 409
    session = ec.client.get(f"/api/practice-sessions/{run['id']}").json()
    assert session["items"][0]["status"] == "stale"
    assert session["status"] == "incomplete"
    helped = _assist(ec, run, kind="first_letter")
    assert helped.status_code == 409


def test_el08_deleted_card_removes_item(ec):
    lesson_id, ids = _seed_lesson(ec, ["apple"])
    run = _create(ec, lesson_id).json()
    item_id = run["items"][0]["id"]
    assert ec.client.delete(f"/api/cards/{ids['apple']}").status_code == 200
    session = ec.client.get(f"/api/practice-sessions/{run['id']}").json()
    assert session["items"] == []
    assert session["status"] == "unavailable"
    assert session["message"]
    attempt = ec.client.post(
        f"/api/practice-sessions/{run['id']}/items/{item_id}/attempts",
        json={"submission_id": str(uuid4()), "answer": "apple"},
    )
    assert attempt.status_code == 404


def test_el08_deleted_card_session_roundtrips(ec, ec_factory):
    lesson_id, ids = _seed_lesson(ec, ["apple"])
    run = _create(ec, lesson_id).json()
    assert ec.client.delete(f"/api/cards/{ids['apple']}").status_code == 200
    session = ec.client.get(f"/api/practice-sessions/{run['id']}").json()
    assert session["lifecycle"] == "unavailable"
    backup = ec.client.get("/api/export/backup").json()
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
    restored = target.client.get(f"/api/practice-sessions/{run['id']}").json()
    assert restored["status"] == "unavailable"
    assert restored["items"] == []


def test_el08_repeated_lesson_word_stays_distinct(ec):
    card_id = ec.seed_card(word="apple", meaning="苹果")
    with ec.SessionLocal() as db:
        lesson = Lesson(
            level=1,
            title="重复词",
            content={
                "words": [
                    {"word": "apple", "meaning": "苹果"},
                    {"word": "apple", "meaning": "苹果"},
                ],
                "dialogue": [],
                "tips": [],
            },
        )
        db.add(lesson)
        db.commit()
        lesson_id = lesson.id
    run = _create(ec, lesson_id)
    assert run.status_code == 200, run.text
    items = run.json()["items"]
    assert len(items) == 1
    assert items[0]["card_id"] == card_id


def test_el08_length_hint_is_not_exposed(ec):
    lesson_id, _ = _seed_lesson(ec, ["apple"])
    run = _create(ec, lesson_id).json()
    response = ec.client.post(
        f"/api/practice-sessions/{run['id']}/items/{run['items'][0]['id']}/assistance",
        json={"kind": "length"},
    )
    assert response.status_code == 422
    session = ec.client.get(f"/api/practice-sessions/{run['id']}").json()
    assert session["items"][0]["assistance"] == []
    assert session["items"][0]["hint"] is None


def test_el08_prefers_words_without_recall_evidence(ec):
    lesson_id, ids = _seed_lesson(ec, ["apple", "book", "cat", "dog"])
    typed = ec.client.post(
        "/api/typing/check",
        json={
            "card_id": ids["apple"],
            "user_input": "apple",
            "source": "spelling",
            "submission_id": str(uuid4()),
        },
    )
    assert typed.status_code == 200
    run = _create(ec, lesson_id).json()
    selected = {item["card_id"] for item in run["items"]}
    assert ids["apple"] not in selected
    assert len(selected) == 3


def test_el08_delete_last_item_clears_lesson_counts(ec):
    lesson_id, ids = _seed_lesson(ec, ["apple"])
    run = _create(ec, lesson_id).json()
    assert _attempt(ec, run, answer="apple").status_code == 200
    assert ec.client.get("/api/lessons/1").json()["learning_progress"][
        "passed_count"
    ] == 1
    assert ec.client.delete(f"/api/cards/{ids['apple']}").status_code == 200
    detail = ec.client.get("/api/lessons/1").json()
    assert detail["learning_progress"]["checked_count"] == 0
    assert detail["learning_progress"]["passed_count"] == 0
    assert detail["learning_progress"]["status"] != "passed"
    session = ec.client.get(f"/api/practice-sessions/{run['id']}").json()
    assert session["items"] == []
    assert session["status"] == "unavailable"


def test_el08_delete_after_complete_updates_lesson_counts(ec):
    lesson_id, ids = _seed_lesson(ec, ["apple", "book"])
    run = _create(ec, lesson_id).json()
    for item in run["items"]:
        word = next(word for word, cid in ids.items() if cid == item["card_id"])
        saved = _attempt(ec, run, answer=word, index=item["position"] - 1)
        assert saved.status_code == 200
        run = saved.json()["session"]
    assert ec.client.get("/api/lessons/1").json()["learning_progress"][
        "checked_count"
    ] == 2
    assert ec.client.delete(f"/api/cards/{ids['apple']}").status_code == 200
    detail = ec.client.get("/api/lessons/1").json()
    assert detail["learning_progress"]["checked_count"] == 1
    assert detail["learning_progress"]["passed_count"] == 1
    session = ec.client.get(f"/api/practice-sessions/{run['id']}").json()
    assert len(session["items"]) == 1
    assert session["status"] == "passed"


def test_el08_session_id_replay_and_conflict(ec):
    lesson_id, _ = _seed_lesson(ec, ["apple"])
    session_id = str(uuid4())
    first = _create(ec, lesson_id, session_id=session_id)
    assert first.status_code == 200
    replay = _create(ec, lesson_id, session_id=session_id)
    assert replay.status_code == 200
    assert replay.json()["items"] == first.json()["items"]
    other_id, _ = _seed_lesson(ec, [], level=2)
    assert _create(ec, other_id, session_id=session_id).status_code == 409


def test_el08_attempt_commit_failure_and_retry(ec):
    lesson_id, ids = _seed_lesson(ec, ["apple"])
    run = _create(ec, lesson_id).json()
    submission_id = str(uuid4())
    ec.fail_commit_once()
    failed = _attempt(ec, run, answer="apple", submission_id=submission_id)
    assert failed.status_code == 500
    session = ec.client.get(f"/api/practice-sessions/{run['id']}").json()
    assert session["items"][0]["status"] == "pending"
    saved = _attempt(ec, run, answer="apple", submission_id=submission_id)
    assert saved.status_code == 200
    replay = _attempt(ec, run, answer="apple", submission_id=submission_id)
    assert replay.status_code == 200
    assert replay.json()["event_id"] == saved.json()["event_id"]
    assert len(ec.client.get(f"/api/cards/{ids['apple']}").json()["learning_events"]) == 1


def test_el08_weak_only_selects_failed_cards(ec):
    lesson_id, ids = _seed_lesson(ec, ["apple", "book"])
    run = _create(ec, lesson_id).json()
    wrong_item = next(item for item in run["items"] if item["card_id"] == ids["book"])
    saved = _attempt(ec, run, answer="wrong", index=wrong_item["position"] - 1)
    first_session = saved.json()["session"]
    for item in first_session["items"]:
        if item["status"] == "pending":
            target = next(
                word for word, cid in ids.items() if cid == item["card_id"]
            )
            _attempt(
                ec, first_session, answer=target, index=item["position"] - 1
            )
    weak = _create(ec, lesson_id, weak_only=True)
    assert weak.status_code == 200, weak.text
    items = weak.json()["items"]
    assert len(items) == 1
    assert items[0]["card_id"] == ids["book"]


def test_el08_submission_id_cannot_cross_context(ec):
    lesson_id, ids = _seed_lesson(ec, ["apple"])
    run = _create(ec, lesson_id).json()
    submission_id = str(uuid4())
    typing = ec.client.post(
        "/api/typing/check",
        json={
            "card_id": ids["apple"],
            "user_input": "apple",
            "source": "spelling",
            "submission_id": submission_id,
        },
    )
    assert typing.status_code == 200, typing.text
    assert _attempt(
        ec, run, answer="apple", submission_id=submission_id
    ).status_code == 409

    practice_submission = str(uuid4())
    first = _attempt(
        ec, run, answer="apple", submission_id=practice_submission
    )
    assert first.status_code == 200
    event = next(
        event
        for event in ec.client.get(f"/api/cards/{ids['apple']}").json()[
            "learning_events"
        ]
        if event["event_id"] == first.json()["event_id"]
    )
    assert event["session_id"] == run["id"]
    other = _create(ec, lesson_id).json()
    assert _attempt(
        ec,
        other,
        answer="apple",
        submission_id=practice_submission,
    ).status_code == 409


def test_el08_practice_starts_post_commit_upgrade(ec, monkeypatch):
    import threading
    from datetime import UTC, datetime

    from app.models.review import Review
    from app.services import learning

    done = threading.Event()
    card_id = ec.seed_card(
        word="apple", example="An apple a day.", example_cn="一天一苹果。"
    )
    with ec.SessionLocal() as db:
        db.add(
            Review(
                card_id=card_id,
                state=2,
                due=datetime.now(UTC).replace(tzinfo=None),
                stability=1,
                difficulty=5,
                elapsed_days=0,
                review_count=2,
            )
        )
        lesson = Lesson(
            level=1,
            title="水果",
            content={
                "words": [{"word": "apple", "meaning": "苹果"}],
                "dialogue": [],
                "tips": [],
            },
        )
        db.add(lesson)
        db.commit()
        lesson_id = lesson.id
    monkeypatch.setattr(learning, "upgrade_sentence_card", lambda _cid: done.set())
    run = _create(ec, lesson_id).json()
    saved = _attempt(ec, run, answer="apple")
    assert saved.status_code == 200, saved.text
    assert done.wait(5)


def test_el08_create_commit_failure_and_retry(ec):
    lesson_id, _ = _seed_lesson(ec, ["apple"])
    session_id = str(uuid4())
    before = ec.snapshot()
    ec.fail_commit_once()
    failed = _create(ec, lesson_id, session_id=session_id)
    assert failed.status_code == 500
    assert ec.snapshot() == before
    assert (
        ec.client.get(f"/api/practice-sessions/{session_id}").status_code == 404
    )
    saved = _create(ec, lesson_id, session_id=session_id)
    assert saved.status_code == 200
    after = ec.snapshot()
    replay = _create(ec, lesson_id, session_id=session_id)
    assert replay.status_code == 200
    assert ec.snapshot() == after


def test_el08_v3_roundtrip_and_continue(ec, ec_factory):
    lesson_id, ids = _seed_lesson(ec, ["apple", "book"])
    run = _create(ec, lesson_id).json()
    first = run["items"][0]
    word = next(word for word, cid in ids.items() if cid == first["card_id"])
    assert _attempt(ec, run, answer=word, index=0).status_code == 200
    backup = ec.client.get("/api/export/backup").json()
    assert "practice_sessions" in backup["features"]
    assert "practice_items" in backup["features"]

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
    restored = target.client.get(f"/api/practice-sessions/{run['id']}").json()
    assert len(restored["items"]) == 2
    assert restored["items"][0]["status"] == "passed"
    assert restored["items"][1]["status"] == "pending"
    restored_cards = {
        row["id"]: row["word"]
        for row in target.client.get("/api/cards").json()["cards"]
    }
    second = restored["items"][1]
    answered = target.client.post(
        f"/api/practice-sessions/{run['id']}/items/{second['id']}/attempts",
        json={
            "submission_id": str(uuid4()),
            "answer": restored_cards[second["card_id"]],
        },
    )
    assert answered.status_code == 200, answered.text
    assert answered.json()["session"]["status"] == "passed"
    detail = target.client.get("/api/lessons/1").json()
    assert detail["learning_progress"]["status"] == "passed"


def test_el08_old_v3_without_practice_stays_readable(ec, ec_factory):
    _seed_lesson(ec, ["apple"])
    backup = ec.client.get("/api/export/backup").json()
    for name in ("practice_sessions", "practice_items"):
        backup["features"].remove(name)
        backup["extensions"].pop(name)
    target = ec_factory()
    preview = target.client.post("/api/import/preview", json=backup)
    assert preview.status_code == 200, preview.text
    assert set(preview.json()["extensions"]["missing"]) == {
        "practice_sessions",
        "practice_items",
    }
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
    assert target.client.get("/api/lessons/1").status_code == 200
    assert (
        target.client.get(f"/api/practice-sessions/{uuid4()}").status_code == 404
    )


@pytest.mark.parametrize(
    "mutation",
    [
        "dangling-session",
        "duplicate-position",
        "duplicate-card",
        "missing-event",
        "wrong-source-event",
        "foreign-session-event",
        "bad-assistance",
        "unavailable-with-items",
    ],
)
def test_el08_v3_rejects_broken_practice_graph(ec, ec_factory, mutation):
    lesson_id, ids = _seed_lesson(ec, ["apple", "book"])
    run = _create(ec, lesson_id).json()
    word = next(
        word for word, cid in ids.items() if cid == run["items"][0]["card_id"]
    )
    assert _attempt(ec, run, answer=word, index=0).status_code == 200
    backup = ec.client.get("/api/export/backup").json()
    sessions = backup["extensions"]["practice_sessions"]
    items = backup["extensions"]["practice_items"]
    if mutation == "dangling-session":
        items[0]["session_id"] = str(uuid4())
    elif mutation == "duplicate-position":
        items[1]["position"] = items[0]["position"]
    elif mutation == "duplicate-card":
        items[1]["card_id"] = items[0]["card_id"]
    elif mutation == "missing-event":
        items[0]["first_event_id"] = str(uuid4())
    elif mutation == "wrong-source-event":
        next(
            event
            for event in backup["learning_events"]
            if event["id"] == items[0]["first_event_id"]
        )["source"] = "spelling"
    elif mutation == "foreign-session-event":
        foreign = str(uuid4())
        event = next(
            event
            for event in backup["learning_events"]
            if event["id"] == items[0]["first_event_id"]
        )
        event["session_id"] = foreign
        event["command_json"]["session_id"] = foreign
    elif mutation == "bad-assistance":
        items[0]["assistance"] = ["length"]
    else:
        sessions[0]["status"] = "unavailable"
    target = ec_factory()
    untouched = target.snapshot()
    preview = target.client.post("/api/import/preview", json=backup)
    assert preview.status_code == 422, preview.text
    assert target.snapshot() == untouched
