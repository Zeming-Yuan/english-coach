"""EL-06：课程、故事与内容编辑保持可追溯的接触和修订。

测试 seam：真实 FastAPI → Alembic 迁移建立的隔离 SQLite。
课程/故事详情只读；接触由浏览器按实际显示上报，晚到翻译不覆盖已变更内容。
"""

from uuid import uuid4

import pytest

from app.models.lesson import Lesson
from app.models.story import Story, StoryWord
from app.services.contacts import visible_card_ids
from app.services.content_revisions import advance_content_revision


def _lesson(ec, *, words, dialogue=()):
    with ec.SessionLocal() as db:
        lesson = Lesson(
            level=1,
            title="水果",
            content={"words": list(words), "dialogue": list(dialogue), "tips": []},
        )
        db.add(lesson)
        db.commit()
        return lesson.id


def _story(ec, card_ids, *, content="An apple a day.", content_cn=None):
    with ec.SessionLocal() as db:
        story = Story(title="Apple Story", content=content, content_cn=content_cn)
        db.add(story)
        db.flush()
        for card_id in card_ids:
            db.add(StoryWord(story_id=story.id, card_id=card_id))
        db.commit()
        return story.id


@pytest.mark.parametrize(
    "arguments, expected",
    [
        (["an apple", [{"id": 1, "word": "apple"}]], [1]),
        (["pineapple", [{"id": 1, "word": "apple"}]], []),
        (["APPLE", [{"id": 1, "word": "apple"}]], [1]),
        (["apple apple", [{"id": 1, "word": "apple"}]], [1]),
        (["pears", [{"id": 1, "word": "pear"}]], []),
        (["an apple and a pear", [{"id": 1, "word": "apple"}, {"id": 2, "word": "pear"}]], [1, 2]),
    ],
)
def test_el06_review_focus(arguments, expected):
    assert visible_card_ids(*arguments) == expected


def test_el06_lesson_has_revision_without_fake_attempt(ec):
    card_id = ec.seed_card(word="apple", meaning="苹果")
    _lesson(
        ec,
        words=[{"word": "apple", "phonetic": "/ˈæpəl/", "meaning": "苹果"}],
        dialogue=[{"speaker": "A", "en": "An apple a day.", "cn": "一天一苹果。"}],
    )
    response = ec.client.get("/api/lessons/1")
    assert response.status_code == 200, response.text
    lesson = response.json()
    assert lesson["content_revision"]["version"] == 1
    assert lesson["words"][0]["id"] == card_id
    assert lesson["words"][0]["content_revision"]["identity"]
    assert lesson["visible_card_ids"] == [card_id]
    assert lesson["dialogue"][0]["visible_card_ids"] == [card_id]
    assert ec.client.get("/api/stats").json()["reviewed_today"] == 0


def test_el06_story_exposes_only_text_visible_targets(ec):
    apple = ec.seed_card(word="apple")
    pear = ec.seed_card(word="pear")
    story_id = _story(ec, [apple, pear], content="An apple a day.")
    response = ec.client.get(f"/api/stories/{story_id}")
    assert response.status_code == 200, response.text
    story = response.json()
    assert story["content_revision"]["version"] == 1
    assert story["visible_card_ids"] == [apple]
    assert story["line_card_ids"] == [[apple]]
    revisions = {word["id"]: word["content_revision"] for word in story["words"]}
    assert revisions[apple]["version"] == 1
    assert revisions[pear]["version"] == 1


def test_el06_late_translation_discarded_after_content_change(ec, monkeypatch):
    from app.models.story import Story as StoryModel
    from app.routers import stories

    card_id = ec.seed_card(word="apple")
    story_id = _story(ec, [card_id], content="An apple a day.")
    before = ec.client.get(f"/api/stories/{story_id}").json()["content_revision"]

    def late_translation(_prompt, _user):
        # 翻译返回前，另一个写到来的新内容（或恢复）替换了故事。
        with ec.SessionLocal() as db:
            story = db.get(StoryModel, story_id)
            advance_content_revision(
                db, "story", story_id, {"content": "A brand new story."}
            )
            story.content = "A brand new story."
            db.commit()
        return {
            "title_cn": "旧翻译",
            "sentences": [{"en": "An apple a day.", "cn": "一天一苹果。"}],
        }

    monkeypatch.setattr(stories, "generate_json", late_translation)
    response = ec.client.get(f"/api/stories/{story_id}")
    assert response.status_code == 200, response.text
    story = response.json()
    assert story["content_revision"] != before
    assert story["content_cn"] is None  # 晚到翻译被丢弃
    assert story["content"] == "A brand new story."


def test_el06_translation_advances_revision(ec, monkeypatch):
    from app.routers import stories

    card_id = ec.seed_card(word="apple")
    story_id = _story(ec, [card_id], content="An apple a day.")
    before = ec.client.get(f"/api/stories/{story_id}").json()["content_revision"]
    monkeypatch.setattr(
        stories,
        "generate_json",
        lambda _prompt, _user: {
            "title_cn": "苹果故事",
            "sentences": [{"en": "An apple a day.", "cn": "一天一苹果。"}],
        },
    )
    story = ec.client.get(f"/api/stories/{story_id}").json()
    assert story["content_cn"] == "一天一苹果。"
    assert story["content_revision"]["identity"] == before["identity"]
    assert story["content_revision"]["version"] == before["version"] + 1


@pytest.mark.parametrize("source", ["lesson", "story"])
def test_el06_reading_sources_record_contact(ec, source):
    card_id = ec.seed_card()
    revision = ec.client.get(f"/api/cards/{card_id}").json()["content_revision"]
    response = ec.client.post(
        "/api/learning/contacts",
        json={
            "submission_id": str(uuid4()),
            "card_id": card_id,
            "revision": revision,
            "source": source,
            "kind": "answer_visible",
        },
    )
    assert response.status_code == 200, response.text
    assert ec.client.get(f"/api/cards/{card_id}").json()["learning_events"] == []


def test_el06_reading_endpoints_do_not_write_learning(ec):
    card_id = ec.seed_card(word="apple")
    lesson_id = _lesson(
        ec, words=[{"word": "apple", "meaning": "苹果"}]
    )
    story_id = _story(ec, [card_id])
    before = ec.snapshot()
    assert ec.client.get(f"/api/lessons/{lesson_id}").status_code == 200
    assert ec.client.get("/api/lessons").status_code == 200
    assert ec.client.get(f"/api/stories/{story_id}").status_code == 200
    assert ec.client.get("/api/stories").status_code == 200
    assert ec.snapshot() == before


def test_el06_late_example_does_not_overwrite_edited_card(ec, monkeypatch):
    from app.models.card import Card
    from app.routers import cards

    card_id = ec.seed_card(word="apple", example="Old example.")
    original = ec.client.get(f"/api/cards/{card_id}").json()["content_revision"]

    def late_example(_word):
        with ec.SessionLocal() as db:
            card = db.get(Card, card_id)
            advance_content_revision(db, "card", card_id, {"meaning": "新释义"})
            card.meaning = "新释义"
            db.commit()
        return ("A late example.", "晚到例句", "讲解")

    monkeypatch.setattr(cards, "regenerate_example", late_example)
    response = ec.client.post(f"/api/cards/{card_id}/regenerate")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["example"] == "Old example."
    assert body["meaning"] == "新释义"
    assert body["content_revision"]["version"] == original["version"] + 1
    detail = ec.client.get(f"/api/cards/{card_id}").json()
    assert detail["example"] == "Old example."
    assert detail["meaning"] == "新释义"
    assert detail["content_revision"]["version"] == original["version"] + 1


def test_el06_refresh_examples_skips_changed_cards(ec, monkeypatch):
    from app.models.card import Card
    from app.services import card_generator

    apple = ec.seed_card(word="apple")
    book = ec.seed_card(word="book")

    def late_example(word):
        if word == "apple":
            with ec.SessionLocal() as db:
                card = db.get(Card, apple)
                advance_content_revision(db, "card", apple, {"meaning": "新苹果"})
                card.meaning = "新苹果"
                db.commit()
        return (f"A new {word} example.", "新例句", "讲解")

    monkeypatch.setattr(card_generator, "regenerate_example", late_example)
    response = ec.client.post("/api/cards/refresh-examples?limit=10")
    assert response.status_code == 200, response.text
    assert response.json()["refreshed"] == 1
    assert ec.client.get(f"/api/cards/{apple}").json()["example"] is None
    assert ec.client.get(f"/api/cards/{book}").json()["example"] == "A new book example."


def test_el06_deleted_targets_are_skipped(ec):
    apple = ec.seed_card(word="apple")
    lesson_id = _lesson(ec, words=[{"word": "apple", "meaning": "苹果"}])
    story_id = _story(ec, [apple])
    assert ec.client.delete(f"/api/cards/{apple}").status_code == 200
    lesson = ec.client.get(f"/api/lessons/{lesson_id}").json()
    assert lesson["words"] == []
    assert lesson["visible_card_ids"] == []
    story = ec.client.get(f"/api/stories/{story_id}").json()
    assert story["words"] == []
    assert story["visible_card_ids"] == []


def test_el06_translation_write_failure_keeps_reading(ec, monkeypatch):
    from sqlalchemy.exc import SQLAlchemyError

    from app.routers import stories

    card_id = ec.seed_card(word="apple")
    story_id = _story(ec, [card_id], content="An apple a day.")
    monkeypatch.setattr(
        stories,
        "generate_json",
        lambda _prompt, _user: {
            "title_cn": "苹果故事",
            "sentences": [{"en": "An apple a day.", "cn": "一天一苹果。"}],
        },
    )

    def broken_write(_db, _operation):
        raise SQLAlchemyError("db down")

    monkeypatch.setattr(stories, "run_write", broken_write)
    response = ec.client.get(f"/api/stories/{story_id}")
    assert response.status_code == 200, response.text
    story = response.json()
    assert story["content"] == "An apple a day."
    assert story["content_cn"] is None


def test_el06_story_contact_roundtrips_through_v3(ec, ec_factory):
    card_id = ec.seed_card()
    revision = ec.client.get(f"/api/cards/{card_id}").json()["content_revision"]
    assert (
        ec.client.post(
            "/api/learning/contacts",
            json={
                "submission_id": str(uuid4()),
                "card_id": card_id,
                "revision": revision,
                "source": "story",
                "kind": "answer_visible",
            },
        ).status_code
        == 200
    )
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
    rows = target.client.get("/api/export/backup").json()["extensions"][
        "learning_contacts"
    ]
    assert len(rows) == 1
    assert rows[0]["source"] == "story"


def test_el06_deleted_story_during_translation_returns_404(ec, monkeypatch):
    from app.models.story import Story
    from app.routers import stories

    card_id = ec.seed_card(word="apple")
    story_id = _story(ec, [card_id], content="An apple a day.")

    def late(_prompt, _user):
        with ec.SessionLocal() as db:
            db.delete(db.get(Story, story_id))
            db.commit()
        return {
            "title_cn": "晚到",
            "sentences": [{"en": "An apple a day.", "cn": "一天一苹果。"}],
        }

    monkeypatch.setattr(stories, "generate_json", late)
    response = ec.client.get(f"/api/stories/{story_id}")
    assert response.status_code == 404


def test_el06_deleted_card_during_regenerate_returns_404(ec, monkeypatch):
    from app.models.card import Card
    from app.routers import cards

    card_id = ec.seed_card(word="apple")

    def late(_word):
        with ec.SessionLocal() as db:
            db.delete(db.get(Card, card_id))
            db.commit()
        return ("A late example.", "晚到", "讲解")

    monkeypatch.setattr(cards, "regenerate_example", late)
    response = ec.client.post(f"/api/cards/{card_id}/regenerate")
    assert response.status_code == 404


def test_el06_refresh_examples_skips_deleted_card(ec, monkeypatch):
    from app.models.card import Card
    from app.services import card_generator

    apple = ec.seed_card(word="apple")
    book = ec.seed_card(word="book")

    def late(word):
        if word == "apple":
            with ec.SessionLocal() as db:
                db.delete(db.get(Card, apple))
                db.commit()
        return (f"A new {word} example.", "新例句", "讲解")

    monkeypatch.setattr(card_generator, "regenerate_example", late)
    response = ec.client.post("/api/cards/refresh-examples?limit=10")
    assert response.status_code == 200, response.text
    assert response.json()["refreshed"] == 1
    assert ec.client.get(f"/api/cards/{book}").json()["example"] == "A new book example."
    assert ec.client.get(f"/api/cards/{apple}").status_code == 404
