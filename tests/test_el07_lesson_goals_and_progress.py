"""EL-07：课程目标与生成/浏览/待检查状态。

测试 seam：真实 FastAPI → Alembic 迁移建立的隔离 SQLite。
生成、浏览确认与后续检查分开；生成数量不再冒充学完。
"""

import copy
from uuid import uuid4

import pytest

from app.models.lesson import Lesson
from app.services.lesson_generator import (
    LessonLevelConflictError,
    generate_lesson,
    lesson_goal,
    validate_lesson,
)
from app.services.lesson_progress import lesson_status
from tests.support.llm_queue import QueuedLLM


def _valid_lesson():
    return {
        "title": "水果",
        "words": [
            {
                "word": "apple",
                "phonetic": "/ˈæpəl/",
                "meaning": "苹果",
                "example": "An apple a day.",
                "example_cn": "一天一苹果。",
            }
        ],
        "dialogue": [
            {"speaker": "A", "en": "An apple a day.", "cn": "一天一苹果。"}
        ],
        "tips": ["注意 apple 的发音"],
    }


def _seed_lesson(ec, level=1, words=None, dialogue=None):
    with ec.SessionLocal() as db:
        lesson = Lesson(
            level=level,
            title="问候",
            content={
                "words": words or [],
                "dialogue": dialogue or [],
                "tips": [],
            },
        )
        db.add(lesson)
        db.commit()
        return lesson.id


def _generate(ec, payload=None, operation_id=None):
    ec.app.state.llm_client = QueuedLLM([payload or _valid_lesson()])
    body = {"operation_id": str(operation_id)} if operation_id else None
    return ec.client.post("/api/lessons/next", json=body) if body else ec.client.post(
        "/api/lessons/next"
    )


@pytest.mark.parametrize(
    "arguments, expected",
    [
        ([False, False, 0, 0], "unavailable"),
        ([True, False, 0, 0], "unrecorded"),
        ([True, True, 0, 0], "browsed"),
        ([True, True, 3, 2], "weak"),
        ([True, True, 3, 3], "passed"),
    ],
)
def test_el07_review_focus(arguments, expected):
    assert lesson_status(*arguments) == expected


def test_el07_generation_is_not_course_completion(ec):
    _seed_lesson(ec)
    course = ec.client.get("/api/lessons/1").json()
    assert course["learning_progress"]["status"] == "unrecorded"
    assert course["learning_progress"]["tracked"] is False
    assert course["learning_progress"]["passed_count"] == 0
    assert course["goal"] == lesson_goal(1)
    assert ec.client.get("/api/stats").json()["reviewed_today"] == 0


def test_el07_generate_records_generated_and_counts(ec):
    response = _generate(ec)
    assert response.status_code == 200, response.text
    lesson = response.json()
    assert lesson["level"] == 1
    assert lesson["learning_progress"]["status"] == "unrecorded"
    assert lesson["learning_progress"]["tracked"] is True
    assert lesson["learning_progress"]["generated"] is True
    assert lesson["goal"] == lesson_goal(1)
    listing = ec.client.get("/api/lessons").json()
    assert listing["counts"] == {
        "total": 1,
        "generated": 1,
        "opened": 0,
        "browsed": 0,
        "unrecorded": 0,
        "old_content": 0,
    }


def test_el07_operation_id_replay_returns_same_lesson(ec):
    operation_id = uuid4()
    first = _generate(ec, operation_id=operation_id)
    assert first.status_code == 200, first.text
    replay = _generate(ec, operation_id=operation_id)
    assert replay.status_code == 200, replay.text
    assert replay.json()["id"] == first.json()["id"]
    assert replay.json()["level"] == 1
    listing = ec.client.get("/api/lessons").json()
    assert len(listing["lessons"]) == 1


def test_el07_viewed_marks_browsed_and_is_idempotent(ec):
    _seed_lesson(ec)
    lesson = ec.client.get("/api/lessons/1").json()
    submission_id = str(uuid4())
    payload = {
        "submission_id": submission_id,
        "revision": lesson["content_revision"],
    }
    saved = ec.client.post("/api/lessons/1/viewed", json=payload)
    assert saved.status_code == 200, saved.text
    assert saved.json()["committed"] is True
    assert saved.json()["learning_progress"]["status"] == "browsed"
    assert saved.json()["learning_progress"]["tracked"] is True
    assert saved.json()["learning_progress"]["browsed_at"]
    replay = ec.client.post("/api/lessons/1/viewed", json=payload)
    assert replay.status_code == 200
    assert replay.json()["learning_progress"] == saved.json()["learning_progress"]
    detail = ec.client.get("/api/lessons/1").json()
    assert detail["learning_progress"]["status"] == "browsed"
    assert ec.client.get("/api/lessons").json()["counts"]["browsed"] == 1
    # 浏览只是一次应用内确认，不是学习事件。
    assert ec.client.get("/api/stats").json()["reviewed_today"] == 0


def test_el07_opened_state_is_separate(ec):
    _seed_lesson(ec)
    first = ec.client.post("/api/lessons/1/opened")
    assert first.status_code == 200, first.text
    progress = first.json()["learning_progress"]
    assert progress["opened"] is True
    assert progress["status"] == "unrecorded"
    assert progress["browsed_at"] is None
    replay = ec.client.post("/api/lessons/1/opened")
    assert replay.status_code == 200
    assert replay.json()["learning_progress"]["opened_at"] == progress["opened_at"]
    listing = ec.client.get("/api/lessons").json()
    assert listing["counts"]["opened"] == 1
    assert listing["counts"]["browsed"] == 0
    assert ec.client.get("/api/stats").json()["reviewed_today"] == 0


def test_el07_view_history_replays_without_rewrite(ec):
    _seed_lesson(ec)
    revision = ec.client.get("/api/lessons/1").json()["content_revision"]
    first_id = str(uuid4())
    second_id = str(uuid4())
    assert (
        ec.client.post(
            "/api/lessons/1/viewed",
            json={"submission_id": first_id, "revision": revision},
        ).status_code
        == 200
    )
    second = ec.client.post(
        "/api/lessons/1/viewed",
        json={"submission_id": second_id, "revision": revision},
    )
    assert second.status_code == 200
    latest = second.json()["learning_progress"]
    replay = ec.client.post(
        "/api/lessons/1/viewed",
        json={"submission_id": first_id, "revision": revision},
    )
    assert replay.status_code == 200
    assert replay.json()["learning_progress"] == latest
    rows = ec.client.get("/api/export/backup").json()["extensions"][
        "lesson_progress"
    ]
    assert len(rows) == 1
    assert rows[0]["view_submission_id"] == second_id
    assert rows[0]["view_submissions"] == [first_id]


def test_el07_viewed_legacy_counts_are_separate(ec):
    _seed_lesson(ec)
    detail = ec.client.get("/api/lessons/1").json()
    saved = ec.client.post(
        "/api/lessons/1/viewed",
        json={
            "submission_id": str(uuid4()),
            "revision": detail["content_revision"],
        },
    )
    assert saved.status_code == 200, saved.text
    listing = ec.client.get("/api/lessons").json()
    assert listing["counts"] == {
        "total": 1,
        "generated": 0,
        "opened": 1,
        "browsed": 1,
        "unrecorded": 0,
        "old_content": 1,
    }
    row = ec.client.get("/api/export/backup").json()["extensions"][
        "lesson_progress"
    ][0]
    assert row["generated"] is False
    assert row["generated_at"][:19] == detail["created_at"][:19]


def test_el07_viewed_conflicts_and_missing(ec):
    _seed_lesson(ec, level=1)
    _seed_lesson(ec, level=2)
    revision = ec.client.get("/api/lessons/1").json()["content_revision"]
    submission_id = str(uuid4())
    assert (
        ec.client.post(
            "/api/lessons/1/viewed",
            json={"submission_id": submission_id, "revision": revision},
        ).status_code
        == 200
    )
    assert (
        ec.client.post(
            "/api/lessons/2/viewed",
            json={"submission_id": submission_id, "revision": revision},
        ).status_code
        == 409
    )
    changed = {**revision, "version": revision["version"] + 1}
    assert (
        ec.client.post(
            "/api/lessons/1/viewed",
            json={"submission_id": str(uuid4()), "revision": changed},
        ).status_code
        == 409
    )
    assert (
        ec.client.post(
            "/api/lessons/99/viewed",
            json={"submission_id": str(uuid4()), "revision": revision},
        ).status_code
        == 404
    )


def test_el07_viewed_commit_failure_and_retry(ec):
    _seed_lesson(ec)
    revision = ec.client.get("/api/lessons/1").json()["content_revision"]
    payload = {"submission_id": str(uuid4()), "revision": revision}
    before = ec.snapshot()
    ec.fail_commit_once()
    failed = ec.client.post("/api/lessons/1/viewed", json=payload)
    assert failed.status_code == 500
    assert ec.snapshot() == before
    saved = ec.client.post("/api/lessons/1/viewed", json=payload)
    assert saved.status_code == 200
    after = ec.snapshot()
    replay = ec.client.post("/api/lessons/1/viewed", json=payload)
    assert replay.status_code == 200
    assert ec.snapshot() == after


@pytest.mark.parametrize(
    "mutation",
    [
        "duplicate-word",
        "missing-meaning",
        "missing-example",
        "missing-example-cn",
        "missing-dialogue-cn",
        "no-words",
        "no-dialogue",
        "bad-tips",
        "not-object",
    ],
)
def test_el07_validate_lesson_rejects_invalid(mutation):
    payload = copy.deepcopy(_valid_lesson())
    if mutation == "duplicate-word":
        payload["words"].append({**payload["words"][0], "word": "APPLE"})
    elif mutation == "missing-meaning":
        payload["words"][0]["meaning"] = ""
    elif mutation == "missing-example":
        payload["words"][0]["example"] = ""
    elif mutation == "missing-example-cn":
        payload["words"][0]["example_cn"] = ""
    elif mutation == "missing-dialogue-cn":
        payload["dialogue"][0]["cn"] = ""
    elif mutation == "no-words":
        payload["words"] = []
    elif mutation == "no-dialogue":
        payload["dialogue"] = []
    elif mutation == "bad-tips":
        payload["tips"] = "hello"
    else:
        payload = "not an object"
    with pytest.raises((ValueError, TypeError)):
        validate_lesson(payload)


def test_el07_invalid_generation_does_not_consume_level(ec):
    invalid = _valid_lesson()
    invalid["words"][0]["meaning"] = ""
    response = _generate(ec, invalid)
    assert response.status_code == 502
    listing = ec.client.get("/api/lessons").json()
    assert listing["lessons"] == []
    assert listing["next_level"] == 1
    valid = _generate(ec)
    assert valid.status_code == 200, valid.text
    assert valid.json()["level"] == 1


def test_el07_commit_failure_leaves_no_half_lesson(ec):
    ec.app.state.llm_client = QueuedLLM([_valid_lesson(), _valid_lesson()])
    before = ec.snapshot()
    ec.fail_commit_once()
    failed = ec.client.post("/api/lessons/next")
    assert failed.status_code == 500
    assert ec.snapshot() == before
    saved = ec.client.post("/api/lessons/next")
    assert saved.status_code == 200, saved.text
    listing = ec.client.get("/api/lessons").json()
    assert len(listing["lessons"]) == 1
    assert listing["lessons"][0]["content"]["words"][0]["word"] == "apple"


def test_el07_service_conflict_does_not_write(ec, monkeypatch):
    from app.services import lesson_generator

    _seed_lesson(ec)
    monkeypatch.setattr(
        lesson_generator, "generate_json", lambda _prompt: _valid_lesson()
    )
    with ec.SessionLocal() as db, pytest.raises(LessonLevelConflictError):
        generate_lesson(db, 1, runtime=ec.runtime)
    assert len(ec.client.get("/api/lessons").json()["lessons"]) == 1


def test_el07_v3_roundtrip_preserves_progress(ec, ec_factory):
    operation_id = uuid4()
    _generate(ec, operation_id=operation_id)
    lesson = ec.client.get("/api/lessons/1").json()
    assert ec.client.post("/api/lessons/1/opened").status_code == 200
    submission_id = str(uuid4())
    assert (
        ec.client.post(
            "/api/lessons/1/viewed",
            json={
                "submission_id": submission_id,
                "revision": lesson["content_revision"],
            },
        ).status_code
        == 200
    )
    backup = ec.client.get("/api/export/backup").json()
    assert "lesson_progress" in backup["features"]
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
    restored = target.client.get("/api/lessons/1").json()
    assert restored["learning_progress"]["status"] == "browsed"
    assert restored["learning_progress"]["tracked"] is True
    assert restored["learning_progress"]["opened"] is True
    assert (
        target.client.post(
            "/api/lessons/1/viewed",
            json={
                "submission_id": submission_id,
                "revision": restored["content_revision"],
            },
        ).status_code
        == 200
    )
    assert len(target.client.get("/api/export/backup").json()["extensions"]["lesson_progress"]) == 1
    replay = target.client.post(
        "/api/lessons/next", json={"operation_id": str(operation_id)}
    )
    assert replay.status_code == 200, replay.text
    assert replay.json()["level"] == 1
    assert len(target.client.get("/api/lessons").json()["lessons"]) == 1


def test_el07_old_v3_without_progress_stays_unrecorded(ec, ec_factory):
    _seed_lesson(ec)
    backup = ec.client.get("/api/export/backup").json()
    backup["features"].remove("lesson_progress")
    backup["extensions"].pop("lesson_progress")
    target = ec_factory()
    preview = target.client.post("/api/import/preview", json=backup)
    assert preview.status_code == 200, preview.text
    assert preview.json()["extensions"]["missing"] == ["lesson_progress"]
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
    restored = target.client.get("/api/lessons/1").json()
    assert restored["learning_progress"]["status"] == "unrecorded"
    assert restored["learning_progress"]["tracked"] is False


@pytest.mark.parametrize(
    "mutation",
    [
        "dangling-lesson",
        "duplicate-generation",
        "duplicate-lesson",
        "duplicate-view",
        "passed-over-checked",
    ],
)
def test_el07_v3_rejects_broken_progress_graph(ec, ec_factory, mutation):
    _seed_lesson(ec)
    revision = ec.client.get("/api/lessons/1").json()["content_revision"]
    assert (
        ec.client.post(
            "/api/lessons/1/viewed",
            json={"submission_id": str(uuid4()), "revision": revision},
        ).status_code
        == 200
    )
    backup = ec.client.get("/api/export/backup").json()
    row = backup["extensions"]["lesson_progress"][0]
    if mutation == "dangling-lesson":
        row["lesson_id"] = 999999
    elif mutation == "duplicate-generation":
        backup["extensions"]["lesson_progress"].append(
            {**row, "id": row["id"] + 1}
        )
    elif mutation == "duplicate-lesson":
        backup["extensions"]["lesson_progress"].append(
            {
                **row,
                "id": row["id"] + 1,
                "generation_id": str(uuid4()),
                "view_submission_id": None,
            }
        )
    elif mutation == "duplicate-view":
        backup["extensions"]["lesson_progress"].append(
            {
                **row,
                "id": row["id"] + 1,
                "generation_id": str(uuid4()),
            }
        )
    else:
        row["checked_count"] = 1
        row["passed_count"] = 2
    target = ec_factory()
    untouched = target.snapshot()
    preview = target.client.post("/api/import/preview", json=backup)
    assert preview.status_code == 422, preview.text
    assert target.snapshot() == untouched
