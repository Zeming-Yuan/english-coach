"""EC-10：完整、带版本的数据库备份导出。

测试 seam：真实 FastAPI → Alembic 迁移建立的隔离 SQLite。
"""

from datetime import datetime, timezone
from uuid import uuid4

import pytest
from sqlalchemy import inspect

from app.models.lesson import Lesson
from app.models.review_baseline import ReviewBaseline
from app.models.story import Story, StoryWord
from app.services.backup import BACKUP_COLLECTIONS, semantic_snapshot, snapshot_revision

TOP_LEVEL_KEYS = {
    "version",
    "exported_at",
    "learning_timezone",
    *(name for name, _model in BACKUP_COLLECTIONS),
}


def test_backup_contains_all_database_collections(ec):
    ec.seed_card(
        word="apple",
        kind="word",
        chunks=[{"text": "an apple", "role": "subject"}],
        related_words=[{"word": "fruit", "meaning": "水果"}],
        difficulty="basic",
    )
    ec.seed_card(
        word="apple",
        kind="sentence",
        example="An apple fell.",
        example_cn="一个苹果掉了。",
    )
    response = ec.client.get("/api/export/backup")
    assert response.status_code == 200
    data = response.json()
    assert data["version"] == 2
    assert len(data["cards"]) == 2
    assert {
        "reviews",
        "learning_events",
        "review_baselines",
        "hard_cards",
        "lessons",
        "stories",
        "story_words",
        "memos",
        "errors",
    } <= data.keys()
    assert data["cards"][0]["chunks"] is not None


def _seed_every_collection(ec):
    """准备全部集合的前置数据：同词两卡型、真实事件、基线与所有关联。"""
    word_id = ec.seed_card(
        word="apple",
        kind="word",
        meaning="苹果",
        phonetic="/ˈæpəl/",
        example="An apple a day.",
        example_cn="一天一苹果。",
        contexts=[{"en": "I like apples.", "cn": "我喜欢苹果。"}],
        explanation="apple 的记忆法",
        related_words=[{"word": "fruit", "meaning": "水果"}],
        chunks=[{"text": "an apple", "role": "subject"}],
        difficulty="basic",
    )
    sentence_id = ec.seed_card(
        word="apple",
        kind="sentence",
        example="An apple fell from the tree.",
        example_cn="一个苹果从树上掉了下来。",
    )
    event = ec.client.post(
        "/api/reviews",
        json={
            "card_id": word_id,
            "rating": 1,
            "source": "study",
            "kind": "self_rating",
            "submission_id": str(uuid4()),
        },
    )
    assert event.status_code == 200
    assert ec.client.put(
        f"/api/memos/{sentence_id}", json={"content": "apple 的记忆法"}
    ).status_code == 200
    assert ec.client.post(f"/api/cards/{word_id}/hard").json()["is_hard"] is True

    db = ec.SessionLocal()
    try:
        db.add(
            ReviewBaseline(
                id=str(uuid4()),
                card_id=sentence_id,
                source_review_id=7,
                source_kind="migration",
                raw={"rating": 2, "word": "apple", "audit": "原始源行"},
                selected=True,
                captured_at=datetime.now(timezone.utc).replace(tzinfo=None),
                last_activity=None,
                cumulative_count=2,
                source_fingerprint="f" * 64,
            )
        )
        db.add(
            Lesson(
                level=1,
                title="第一课",
                content={"words": ["apple"], "dialogue": []},
            )
        )
        story = Story(
            title="An apple story",
            content="An apple fell.",
            content_cn="一个苹果掉了。",
            title_cn="苹果故事",
        )
        db.add(story)
        db.flush()
        db.add(StoryWord(story_id=story.id, card_id=word_id))
        db.add(StoryWord(story_id=story.id, card_id=sentence_id))
        db.commit()
        story_id = story.id
    finally:
        db.close()
    return word_id, sentence_id, story_id


def test_backup_exports_every_model_column_and_association(ec):
    word_id, sentence_id, story_id = _seed_every_collection(ec)

    data = ec.client.get("/api/export/backup").json()
    assert set(data) == TOP_LEVEL_KEYS
    assert data["learning_timezone"] == ec.runtime.learning_timezone
    assert datetime.fromisoformat(data["exported_at"]).utcoffset() is not None

    # 每个集合都有数据，且每行包含对应模型的全部列（新列自动进入备份）。
    for name, model in BACKUP_COLLECTIONS:
        rows = data[name]
        assert rows, f"{name} should not be empty"
        expected_fields = {column.key for column in inspect(model).columns}
        for row in rows:
            assert set(row) == expected_fields, name

    # 同词不同卡型独立，使用各自稳定 ID 引用。
    assert {card["id"] for card in data["cards"]} == {word_id, sentence_id}
    assert [(card["word"], card["kind"]) for card in data["cards"]] == [
        ("apple", "word"),
        ("apple", "sentence"),
    ]
    assert data["cards"][0]["chunks"] == [{"text": "an apple", "role": "subject"}]
    assert data["cards"][0]["difficulty"] == "basic"

    # 事件、当前状态、记忆法、错词、困难词与故事关联都指向正确的卡。
    assert [review["card_id"] for review in data["reviews"]] == [word_id]
    assert [event["card_id"] for event in data["learning_events"]] == [word_id]
    assert data["learning_events"][0]["submission_id"]
    assert data["learning_events"][0]["command_json"]
    assert data["learning_events"][0]["response"]
    assert [memo["card_id"] for memo in data["memos"]] == [sentence_id]
    assert [error["card_id"] for error in data["errors"]] == [word_id]
    assert [hard["card_id"] for hard in data["hard_cards"]] == [word_id]
    assert data["review_baselines"][0]["card_id"] == sentence_id
    assert data["review_baselines"][0]["raw"]["audit"] == "原始源行"
    assert data["lessons"][0]["content"]["words"] == ["apple"]
    assert data["stories"][0]["id"] == story_id
    assert {(link["story_id"], link["card_id"]) for link in data["story_words"]} == {
        (story_id, word_id),
        (story_id, sentence_id),
    }


def test_semantic_snapshot_excludes_only_export_time(ec):
    ec.seed_card(word="apple")
    first = ec.client.get("/api/export/backup").json()
    ec.set_time("2026-11-01T09:30:00+00:00")
    second = ec.client.get("/api/export/backup").json()

    assert first["exported_at"] != second["exported_at"]
    assert "exported_at" not in semantic_snapshot(first)
    assert semantic_snapshot(first) == semantic_snapshot(second)
    assert snapshot_revision(first) == snapshot_revision(second)


def _revision_sample(cards):
    return {
        "version": 2,
        "exported_at": "2026-10-30T12:00:00+00:00",
        "learning_timezone": "Asia/Shanghai",
        "cards": cards,
        "reviews": [],
        "learning_events": [],
        "review_baselines": [],
        "memos": [],
        "errors": [],
        "hard_cards": [],
        "lessons": [],
        "stories": [],
        "story_words": [],
    }


def test_snapshot_revision_is_a_pinned_canonical_digest():
    """固定校验样本：后续恢复票依赖同一语义摘要。"""
    sample = _revision_sample([{"id": 1, "word": "apple"}])
    assert (
        snapshot_revision(sample)
        == "4de0c10ff9d3247203427baba022721f1ae79c1e2092bb0eb92ecc405cdddca2"
    )


def test_snapshot_revision_normalizes_order_and_ignores_export_time():
    payload = _revision_sample(
        [{"id": 2, "word": "banana"}, {"id": 1, "word": "apple"}]
    )
    reordered = {
        **_revision_sample(
            [{"id": 1, "word": "apple"}, {"id": 2, "word": "banana"}]
        ),
        "exported_at": "2026-11-02T08:00:00+00:00",
    }
    changed = _revision_sample(
        [{"id": 2, "word": "banana"}, {"id": 1, "word": "pear"}]
    )

    assert snapshot_revision(payload) == snapshot_revision(reordered)
    assert snapshot_revision(changed) != snapshot_revision(payload)


def test_legacy_export_endpoint_remains_compatible_and_is_not_v2(ec):
    card_id = ec.seed_card(
        word="apple",
        chunks=[{"text": "an apple", "role": "subject"}],
    )

    legacy = ec.client.get("/api/export/cards")
    assert legacy.status_code == 200
    data = legacy.json()
    assert "version" not in data
    assert data["cards"][0]["id"] == card_id
    assert data["cards"][0]["chunks"] == [
        {"text": "an apple", "role": "subject"}
    ]
    assert {"reviews", "memos", "errors"} <= set(data)

    complete = ec.client.get("/api/export/backup")
    assert complete.status_code == 200
    assert complete.json()["version"] == 2


def test_backup_excludes_configuration_caches_and_browser_preferences(ec):
    """RF5：密钥/环境/语音缓存/浏览器偏好不进入备份，下载名固定。"""
    ec.seed_card(word="apple")

    response = ec.client.get("/api/export/backup")
    assert response.status_code == 200
    assert (
        response.headers["content-disposition"]
        == 'attachment; filename="english-coach-backup.json"'
    )
    text = response.text
    for forbidden in (
        "llm_api_key",
        "LLM_API_KEY",
        "deepseek",
        "127.0.0.1:9",
        "tts_cache",
        "localStorage",
        "alembic_version",
    ):
        assert forbidden not in text


def test_export_reuses_existing_transaction_without_committing(ec):
    """RF4：已有写事务时复用同一快照，不自行 commit 调用者的数据。"""
    from app.models.card import Card
    from app.services.backup import export_backup

    db = ec.SessionLocal()
    try:
        db.add(Card(word="pending", kind="word", meaning="待提交"))
        db.flush()
        payload = export_backup(db, ec.runtime)
        assert [card["word"] for card in payload["cards"]] == ["pending"]
        db.rollback()
    finally:
        db.close()

    assert ec.client.get("/api/export/backup").json()["cards"] == []


@pytest.mark.parametrize(
    "field", ["contexts", "related_words", "chunks", "difficulty", "explanation"]
)
def test_backup_review_focus_card_fields(ec, field):
    """RF2：Card 新增字段不遗漏。"""
    values = {
        "contexts": [{"en": "Hello", "cn": "你好"}],
        "related_words": [{"word": "fruit", "meaning": "水果"}],
        "chunks": [{"text": "an apple", "role": "subject"}],
        "difficulty": "basic",
        "explanation": "测试说明",
    }
    card_id = ec.seed_card(**{field: values[field]})
    data = ec.client.get("/api/export/backup").json()
    assert next(card for card in data["cards"] if card["id"] == card_id)[field] == values[field]
