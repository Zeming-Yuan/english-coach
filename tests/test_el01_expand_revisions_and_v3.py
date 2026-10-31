"""EL-01：内容修订身份与 V3 完整备份。

测试 seam：真实 FastAPI → Alembic 迁移建立的隔离 SQLite。
数据模型只用于准备旧数据，实际被测行为走公开 HTTP。
"""

import copy
import json

import pytest

from app.services.content_revisions import next_revision


def _revision(ec, card_id):
    return ec.client.get(f"/api/cards/{card_id}").json()["content_revision"]


def _backup(ec):
    return ec.client.get("/api/export/backup").json()


def _as_v2(payload):
    """把当前 V3 快照降成合法 V2 文件（模拟旧版本导出的备份）。"""
    payload = copy.deepcopy(payload)
    payload.pop("features")
    payload.pop("extensions")
    payload["version"] = 2
    return payload


def test_el01_edit_and_v3_contract(ec):
    card_id = ec.seed_card()
    before = ec.client.get(f"/api/cards/{card_id}").json()
    response = ec.client.put(f"/api/cards/{card_id}", json={"meaning": "一个苹果"})
    assert response.status_code == 200
    after = response.json()
    assert (
        after["content_revision"]["version"]
        == before["content_revision"]["version"] + 1
    )
    backup = ec.client.get("/api/export/backup").json()
    assert backup["version"] == 3
    assert "content_revisions" in backup["extensions"]


@pytest.mark.parametrize(
    "arguments, expected",
    [
        ([{"meaning": "苹果"}, {"meaning": "苹果"}, 1], 1),
        ([{"meaning": "苹果"}, {"meaning": "一个苹果"}, 1], 2),
        ([{"word": "apple"}, {"word": "pear"}, 4], 5),
        ([{"meaning": "苹果"}, {"memo": "红色"}, 3], 3),
        ([{"example": "A"}, {"example": "B"}, 8], 9),
        ([{"example": "A small apple."}, {"example": " A  small\n apple. "}, 8], 8),
        (
            [{"contexts": [{"en": "An apple"}]}, {"contexts": [{"en": "An  apple "}]}, 8],
            8,
        ),
    ],
)
def test_el01_review_focus(arguments, expected):
    assert next_revision(*arguments) == expected


@pytest.mark.parametrize(
    ("field", "value", "spaced"),
    [
        ("word", "pear", None),
        ("meaning", "一个苹果", None),
        ("example", "A red apple.", " A  red\n apple. "),
        ("example_cn", "一个 红苹果。", " 一个  红苹果。 "),
        (
            "contexts",
            [{"en": "An apple.", "cn": "一个苹果。"}],
            [{"en": "An  apple.", "cn": "一个苹果。"}],
        ),
    ],
)
def test_el01_semantic_fields_advance_revision(ec, field, value, spaced):
    card_id = ec.seed_card(word="apple", meaning="苹果")
    before = _revision(ec, card_id)
    changed = ec.client.put(f"/api/cards/{card_id}", json={field: value})
    assert changed.status_code == 200, changed.text
    assert changed.json()["content_revision"] == {
        "identity": before["identity"],
        "version": before["version"] + 1,
    }
    # 重复保存相同内容不重复递增。
    repeat = ec.client.put(f"/api/cards/{card_id}", json={field: value})
    assert repeat.json()["content_revision"]["version"] == before["version"] + 1
    # 仅排版差异同样不增加。
    if spaced is not None:
        spaced_response = ec.client.put(f"/api/cards/{card_id}", json={field: spaced})
        assert spaced_response.status_code == 200, spaced_response.text
        assert (
            spaced_response.json()["content_revision"]["version"]
            == before["version"] + 1
        )


def test_el01_non_semantic_edits_keep_revision(ec):
    card_id = ec.seed_card(
        meaning="苹果",
        example="An apple.",
        phonetic="/ˈæpəl/",
        explanation="apple 的讲解",
    )
    first = _revision(ec, card_id)

    # 仅排版差异不增加修订。
    assert ec.client.put(
        f"/api/cards/{card_id}", json={"example": "  An   apple.\n"}
    ).status_code == 200
    # 音标/讲解不改变语义证据。
    assert ec.client.put(
        f"/api/cards/{card_id}", json={"phonetic": "/x/", "explanation": "新讲解"}
    ).status_code == 200
    # 记忆法不改变修订。
    assert (
        ec.client.put(f"/api/memos/{card_id}", json={"content": "谐音：阿婆"}).status_code
        == 200
    )
    assert _revision(ec, card_id) == first


def test_el01_commit_failure_and_retry(ec):
    card_id = ec.seed_card()
    path = f"/api/cards/{card_id}"
    payload = {"meaning": "一个苹果"}
    before = ec.snapshot()

    ec.fail_commit_once()
    failed = ec.client.put(path, json=payload)
    assert failed.status_code == 500
    assert ec.snapshot() == before

    saved = ec.client.put(path, json=payload)
    assert saved.status_code == 200
    after = ec.snapshot()
    replay = ec.client.put(path, json=payload)
    assert replay.status_code == 200
    assert ec.snapshot() == after


def test_el01_v3_roundtrip_keeps_identity_and_continues(ec, ec_factory):
    card_id = ec.seed_card(meaning="苹果")
    ec.client.put(f"/api/cards/{card_id}", json={"meaning": "一个苹果"})
    before = _revision(ec, card_id)
    backup = _backup(ec)

    target = ec_factory()
    preview = target.client.post("/api/import/preview", json=backup)
    assert preview.status_code == 200, preview.text
    assert preview.json()["version"] == 3
    assert preview.json()["extensions"] == {
        "provided": ["content_revisions"],
        "missing": [],
    }
    restored = target.client.post(
        "/api/import/cards",
        json={
            "backup": backup,
            "expected_revision": preview.json()["expected_revision"],
        },
    )
    assert restored.status_code == 200, restored.text

    restored_backup = _backup(target)
    restored_card = next(
        card for card in restored_backup["cards"] if card["word"] == "apple"
    )
    assert (
        target.client.get(f"/api/cards/{restored_card['id']}").json()[
            "content_revision"
        ]
        == before
    )
    continued = target.client.put(
        f"/api/cards/{restored_card['id']}", json={"meaning": "苹果（改）"}
    ).json()["content_revision"]
    assert continued == {
        "identity": before["identity"],
        "version": before["version"] + 1,
    }


def test_el01_v3_roundtrip_preserves_lesson_and_story_revisions(ec, ec_factory):
    from app.models.lesson import Lesson
    from app.models.story import Story

    source = ec_factory()
    db = source.SessionLocal()
    try:
        lesson = Lesson(level=1, title="Greetings", content={"words": []})
        story = Story(title="A walk", content="A short story.")
        db.add_all([lesson, story])
        db.commit()
        source_ids = {"lesson": lesson.id, "story": story.id}
    finally:
        db.close()
    backup = _backup(source)
    before = {
        row["resource_kind"]: row
        for row in backup["extensions"]["content_revisions"]
    }

    target = ec_factory()
    # Pre-existing entities force the restored lesson/story IDs to be remapped.
    db = target.SessionLocal()
    try:
        db.add_all(
            [
                Lesson(level=99, title="Old lesson", content={}),
                Story(title="Old story", content="Old."),
            ]
        )
        db.commit()
    finally:
        db.close()
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

    restored = _backup(target)
    titles = {
        "lesson": {row["id"]: row["title"] for row in restored["lessons"]},
        "story": {row["id"]: row["title"] for row in restored["stories"]},
    }
    after = {
        row["resource_kind"]: row
        for row in restored["extensions"]["content_revisions"]
    }
    for kind in ("lesson", "story"):
        # Identity/version survive; only the resource ID is remapped.
        assert after[kind]["identity"] == before[kind]["identity"]
        assert after[kind]["version"] == before[kind]["version"]
        assert after[kind]["resource_id"] != source_ids[kind]
        assert after[kind]["resource_id"] in titles[kind]


def test_el01_v3_restore_invalidates_source_question_token(ec, ec_factory):
    from uuid import uuid4

    source = ec_factory()
    for word in ["apple", "book", "cat", "dog"]:
        source.seed_card(word=word, meaning=word)
    question = source.client.get("/api/listening?limit=1").json()["questions"][0]
    backup = _backup(source)

    target = ec_factory()
    preview = target.client.post("/api/import/preview", json=backup)
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
    restored = _backup(target)
    card = next(
        row for row in restored["cards"] if row["word"] == question["word"]
    )
    response = target.client.post(
        "/api/listening/score",
        json={
            "card_id": card["id"],
            "question_token": question["question_token"],
            "answer": question["word"],
            "source": "listening",
            "kind": "choice",
            "submission_id": str(uuid4()),
        },
    )
    assert response.status_code == 409
    assert restored["learning_events"] == []


def test_el01_v2_preview_reports_missing_extensions_and_restore_regenerates(
    ec, ec_factory
):
    source = ec_factory()
    card_id = source.seed_card(meaning="苹果")
    before = _revision(source, card_id)
    v2 = _as_v2(_backup(source))

    target = ec_factory()
    target.seed_card("keep")
    untouched = target.snapshot()
    preview = target.client.post("/api/import/preview", json=v2)
    assert preview.status_code == 200, preview.text
    assert preview.json()["version"] == 2
    assert preview.json()["extensions"]["missing"] == ["content_revisions"]
    assert preview.json()["impact"]["replaced"]["content_revisions"] >= 1
    assert target.snapshot() == untouched

    restored = target.client.post(
        "/api/import/cards",
        json={
            "backup": v2,
            "expected_revision": preview.json()["expected_revision"],
        },
    )
    assert restored.status_code == 200, restored.text
    restored_backup = _backup(target)
    card = next(row for row in restored_backup["cards"] if row["word"] == "apple")
    revision = next(
        row
        for row in restored_backup["extensions"]["content_revisions"]
        if row["resource_kind"] == "card" and row["resource_id"] == card["id"]
    )
    assert revision["version"] == 1
    assert revision["identity"] != before["identity"]


def test_el01_v1_partial_keeps_matched_identity_and_adds_new(ec):
    card_id = ec.seed_card(word="apple", meaning="苹果")
    before = _revision(ec, card_id)
    payload = {
        "cards": [
            {"id": 1, "word": "apple", "kind": "word", "meaning": "苹果"},
            {"id": 2, "word": "banana", "kind": "word", "meaning": "香蕉"},
        ],
        "reviews": [],
        "memos": [],
        "errors": [],
    }
    preview = ec.client.post("/api/import/preview", json=payload)
    assert preview.status_code == 200, preview.text
    assert preview.json()["mode"] == "legacy_partial"
    assert preview.json()["extensions"]["missing"] == ["content_revisions"]
    assert (
        ec.client.post(
            "/api/import/cards",
            json={
                "backup": payload,
                "expected_revision": preview.json()["expected_revision"],
            },
        ).status_code
        == 200
    )

    exported = _backup(ec)
    cards = {row["word"]: row["id"] for row in exported["cards"]}
    revisions = {
        (row["resource_kind"], row["resource_id"]): row
        for row in exported["extensions"]["content_revisions"]
    }
    assert revisions[("card", card_id)]["identity"] == before["identity"]
    assert revisions[("card", card_id)]["version"] == before["version"]
    added = revisions[("card", cards["banana"])]
    assert added["version"] == 1
    assert added["identity"] != before["identity"]


def test_el01_v1_content_change_advances_revision(ec):
    card_id = ec.seed_card(word="apple", meaning="苹果")
    before = _revision(ec, card_id)
    payload = {
        "cards": [{"id": 1, "word": "apple", "kind": "word", "meaning": "香蕉"}],
        "reviews": [],
        "memos": [],
        "errors": [],
    }
    assert ec.client.post("/api/import/cards", json=payload).status_code == 200
    changed = _revision(ec, card_id)
    assert changed == {
        "identity": before["identity"],
        "version": before["version"] + 1,
    }
    # 同一旧文件重复导入不重复推进修订。
    assert ec.client.post("/api/import/cards", json=payload).status_code == 200
    assert _revision(ec, card_id) == changed


def test_el01_v3_unknown_feature_rejected(ec, ec_factory):
    source = ec_factory()
    source.seed_card()
    backup = _backup(source)
    backup["features"].append("future_notes")
    backup["extensions"]["future_notes"] = []

    target = ec_factory()
    target.seed_card("keep")
    untouched = target.snapshot()
    response = target.client.post("/api/import/preview", json=backup)
    assert response.status_code == 422
    assert "未知功能" in json.dumps(response.json(), ensure_ascii=False)
    assert target.snapshot() == untouched


@pytest.mark.parametrize(
    "mutation",
    ["missing-entity", "duplicate", "duplicate-identity", "bad-identity"],
)
def test_el01_v3_invalid_revision_graph_rejected(ec, ec_factory, mutation):
    source = ec_factory()
    source.seed_card("apple")
    source.seed_card("pear")
    backup = _backup(source)
    rows = backup["extensions"]["content_revisions"]
    assert len(rows) == 2
    if mutation == "missing-entity":
        rows[0]["resource_id"] = 999999
    elif mutation == "duplicate":
        rows.append({**rows[0], "id": rows[0]["id"] + 1})
    elif mutation == "duplicate-identity":
        rows[1]["identity"] = rows[0]["identity"]
    else:
        rows[0]["identity"] = "not-a-uuid"

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


def test_el01_v3_story_revision_reference_validated(ec, ec_factory):
    from app.models.story import Story

    source = ec_factory()
    db = source.SessionLocal()
    try:
        story = Story(title="A walk", content="A short story.")
        db.add(story)
        db.commit()
    finally:
        db.close()
    backup = _backup(source)
    row = next(
        item
        for item in backup["extensions"]["content_revisions"]
        if item["resource_kind"] == "story"
    )
    row["resource_id"] = 999999

    target = ec_factory()
    target.seed_card("keep")
    untouched = target.snapshot()
    preview = target.client.post("/api/import/preview", json=backup)
    assert preview.status_code == 422
    assert target.snapshot() == untouched


def test_el01_v3_restore_fault_keeps_target_and_safety_copy(ec, ec_factory):
    source = ec_factory()
    source.seed_card("apple")
    backup = _backup(source)

    target = ec_factory()
    target.seed_card("keep")
    untouched = target.snapshot()
    preview = target.client.post("/api/import/preview", json=backup)
    assert preview.status_code == 200
    target.fail_commit_once()
    failed = target.client.post(
        "/api/import/cards",
        json={
            "backup": backup,
            "expected_revision": preview.json()["expected_revision"],
        },
    )
    assert failed.status_code == 500
    assert target.snapshot() == untouched
    copies = list((target.root / "backups").glob("before-restore-*.json"))
    assert copies
    saved = json.loads(copies[0].read_text(encoding="utf-8"))
    assert saved["version"] == 3
    assert "content_revisions" in saved["extensions"]


def test_el01_delete_card_removes_revision(ec):
    card_id = ec.seed_card()
    assert ec.client.delete(f"/api/cards/{card_id}").status_code == 200
    rows = _backup(ec)["extensions"]["content_revisions"]
    assert all(
        not (row["resource_kind"] == "card" and row["resource_id"] == card_id)
        for row in rows
    )


def test_el01_upgrade_backfills_existing_entities(tmp_path):
    from pathlib import Path

    from alembic.config import Config
    from sqlalchemy import create_engine, text

    from alembic import command

    root = Path(__file__).resolve().parents[1]
    database = tmp_path / "legacy.db"
    url = f"sqlite:///{database.as_posix()}"
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", url)
    command.upgrade(config, "b1c2d3e4f503")
    engine = create_engine(url)
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO cards (id, word, kind, meaning) "
                    "VALUES (7, 'apple', 'word', '苹果')"
                )
            )
            conn.execute(
                text(
                    "INSERT INTO lessons (id, level, title, content, created_at) "
                    "VALUES (3, 1, 'Greetings', '{}', '2026-10-30 00:00:00')"
                )
            )
            conn.execute(
                text(
                    "INSERT INTO stories (id, title, content, created_at) "
                    "VALUES (5, 'Walk', 'A walk.', '2026-10-30 00:00:00')"
                )
            )
    finally:
        engine.dispose()

    command.upgrade(config, "head")

    engine = create_engine(url)
    try:
        with engine.connect() as conn:
            rows = conn.execute(
                text(
                    "SELECT resource_kind, resource_id, identity, version "
                    "FROM content_revisions ORDER BY resource_kind"
                )
            ).all()
            events = conn.execute(text("SELECT COUNT(*) FROM review_events")).scalar()
    finally:
        engine.dispose()

    assert [(row[0], row[1], row[3]) for row in rows] == [
        ("card", 7, 1),
        ("lesson", 3, 1),
        ("story", 5, 1),
    ]
    assert len({row[2] for row in rows}) == 3
    assert events == 0


def test_el01_background_upgrade_rejected_after_revision_change(ec, monkeypatch):
    import threading
    from datetime import UTC, datetime
    from types import SimpleNamespace

    import app.db
    from app.models.review import Review
    from app.services import review_submission

    entered, release, finished = (
        threading.Event(),
        threading.Event(),
        threading.Event(),
    )

    def complete(**_kwargs):
        entered.set()
        assert release.wait(10)
        return SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(
                        content=json.dumps(
                            {"example": "STALE AI CONTENT", "example_cn": "过期"}
                        )
                    )
                )
            ]
        )

    ec.app.state.llm_client = SimpleNamespace(
        chat=SimpleNamespace(completions=SimpleNamespace(create=complete))
    )
    monkeypatch.setattr(app.db, "SessionLocal", ec.SessionLocal)
    original = review_submission.upgrade_sentence_card

    def wrapped(card_id):
        try:
            original(card_id)
        finally:
            finished.set()

    monkeypatch.setattr(review_submission, "upgrade_sentence_card", wrapped)

    card_id = ec.seed_card(example="Original example.", example_cn="原文")
    db = ec.SessionLocal()
    try:
        db.add(
            Review(
                card_id=card_id,
                state=1,
                step=0,
                due=datetime(2026, 10, 30, tzinfo=UTC).replace(tzinfo=None),
                stability=1,
                difficulty=5,
                elapsed_days=0,
                review_count=2,
            )
        )
        db.commit()
    finally:
        db.close()

    assert (
        ec.client.post(
            "/api/reviews",
            json={"card_id": card_id, "rating": 3, "source": "study"},
        ).status_code
        == 200
    )
    assert entered.wait(5)
    assert (
        ec.client.put(f"/api/cards/{card_id}", json={"meaning": "新释义"}).status_code
        == 200
    )
    release.set()
    assert finished.wait(5)

    cards = ec.client.get("/api/export/backup").json()["cards"]
    assert all(card["example"] != "STALE AI CONTENT" for card in cards)


def test_el01_regenerated_example_advances_revision(ec):
    from tests.support.llm_queue import QueuedLLM

    card_id = ec.seed_card(word="apple", example="Old.", example_cn="旧")
    before = _revision(ec, card_id)
    ec.app.state.llm_client = QueuedLLM(
        [{"example": "A new example.", "example_cn": "新例句", "explanation": "讲解"}]
    )
    response = ec.client.post(f"/api/cards/{card_id}/regenerate")
    assert response.status_code == 200, response.text
    assert response.json()["example"] == "A new example."
    assert _revision(ec, card_id) == {
        "identity": before["identity"],
        "version": before["version"] + 1,
    }


def test_el01_queued_llm_is_explicit_and_never_falls_back():
    from tests.support.llm_queue import QueuedLLM

    llm = QueuedLLM([{"example": "An apple."}])
    response = llm.chat.completions.create(model="test", messages=[])
    assert json.loads(response.choices[0].message.content) == {
        "example": "An apple."
    }
    with pytest.raises(RuntimeError, match="exhausted"):
        llm.chat.completions.create(model="test", messages=[])

    timeout = QueuedLLM([TimeoutError("fixture timeout")])
    with pytest.raises(TimeoutError):
        timeout.chat.completions.create(model="test", messages=[])


def test_el01_lessons_and_stories_get_revisions(ec):
    from app.models.lesson import Lesson
    from app.models.story import Story

    db = ec.SessionLocal()
    try:
        lesson = Lesson(level=1, title="Greetings", content={"words": []})
        story = Story(title="A walk", content="A short story.")
        db.add_all([lesson, story])
        db.commit()
        lesson_id, story_id = lesson.id, story.id
    finally:
        db.close()

    rows = _backup(ec)["extensions"]["content_revisions"]
    keys = {(row["resource_kind"], row["resource_id"]) for row in rows}
    assert ("lesson", lesson_id) in keys
    assert ("story", story_id) in keys
