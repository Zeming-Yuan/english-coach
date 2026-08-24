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
    story = Story(title="Test Story", content="Once upon a time...")
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


MOCK_STORY_RESPONSE = '{"title":"A Day at School","story":"Tom likes apple and banana.","words":[{"word":"apple","phonetic":"/ˈæpəl/","meaning":"苹果"},{"word":"banana","phonetic":"/bəˈnænə/","meaning":"香蕉"}]}'


@patch("app.services.story_generator.client")
def test_generate_story(mock_client, client, db_session):
    """POST /api/stories/generate 生成故事并入库。"""
    make_word_card(db_session, 3)
    # mock DeepSeek 返回
    mock_resp = type(
        "Resp",
        (),
        {
            "choices": [
                type(
                    "Choice",
                    (),
                    {"message": type("Msg", (), {"content": MOCK_STORY_RESPONSE})()},
                )()
            ]
        },
    )()
    mock_client.chat.completions.create.return_value = mock_resp
    resp = client.post("/api/stories/generate")
    assert resp.status_code == 200
    data = resp.json()
    assert data["title"] == "A Day at School"
    assert len(data["words"]) == 3


def test_generate_story_no_words(client, db_session):
    """新词不足 → 400。"""
    resp = client.post("/api/stories/generate")
    assert resp.status_code == 400
    assert "新词不足" in resp.json()["detail"]
