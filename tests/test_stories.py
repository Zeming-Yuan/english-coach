"""故事路由测试。"""

from unittest.mock import patch

from app.models.card import Card
from app.models.story import Story, StoryWord


def make_word_card(db, count=3):
    """创建几张新词卡（无复习记录）。"""
    words = [("apple", "苹果"), ("banana", "香蕉"), ("cherry", "樱桃")]
    cards = []
    for word, meaning in words[:count]:
        card = Card(word=word, meaning=meaning, kind="word")
        db.add(card)
        cards.append(card)
    db.commit()
    for c in cards:
        db.refresh(c)
    return cards


def test_get_story(client, db_session):
    """GET /api/stories/{id} 返回故事 + 关联词。"""
    story = Story(
        title="Test Story",
        content="Once upon a time...",
        content_cn="从前……",  # 已有翻译：不触发可选 AI 补翻
    )
    db_session.add(story)
    db_session.flush()
    cards = make_word_card(db_session, 2)
    for card in cards:
        db_session.add(StoryWord(story_id=story.id, card_id=card.id))
    db_session.commit()

    resp = client.get(f"/api/stories/{story.id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["title"] == "Test Story"
    assert len(data["words"]) == 2
    assert data["words"][0]["word"] in ("apple", "banana")


def test_get_story_not_found(client):
    """GET /api/stories/{id} 故事不存在返回 404。"""
    resp = client.get("/api/stories/999")
    assert resp.status_code == 404


@patch("app.routers.stories.generate_json")
def test_get_story_without_ai_stays_readable(mock_generate, client, db_session):
    """AI 未配置时旧故事仍可读：补翻是可选项，不阻断已有内容。"""
    from app.services.llm_client import LLMNotConfigured

    mock_generate.side_effect = LLMNotConfigured("AI 未配置")
    story = Story(title="Old Story", content="Once upon a time...")
    db_session.add(story)
    db_session.commit()

    resp = client.get(f"/api/stories/{story.id}")
    assert resp.status_code == 200
    assert resp.json()["title"] == "Old Story"
    assert resp.json()["content_cn"] is None


@patch("app.services.story_generator.generate_json")
def test_generate_story_without_recall_uses_starter(mock_generate, client, db_session):
    """Unreviewed cards are not known vocabulary; checked starter needs no AI."""
    make_word_card(db_session, 3)
    resp = client.post("/api/stories/generate")
    assert resp.status_code == 200
    assert resp.json()["mode"] == "starter"
    assert resp.json()["quality"]["known_targets"] == []
    assert client.get("/api/stories").json()["stories"] == []
    mock_generate.assert_not_called()


def test_generate_story_no_words(client, db_session):
    """Empty vocabulary gets checked reading material without adding cards."""
    resp = client.post("/api/stories/generate")
    assert resp.status_code == 200
    assert resp.json()["mode"] == "starter"
    assert client.get("/api/cards").json()["cards"] == []
