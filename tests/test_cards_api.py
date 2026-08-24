"""词卡 API 测试（生成端点 mock AI）。"""

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from app.models.card import Card
from app.models.review import Review


def test_list_cards_empty(client):
    """空库 → 空列表。"""
    resp = client.get("/api/cards")
    assert resp.status_code == 200
    assert resp.json()["cards"] == []


def test_list_cards_with_review_state(client, db_session):
    """列表含复习状态：未毕业词 review_count=0，已毕业词 graduated=True。"""
    db_session.add(Card(word="apple", meaning="苹果", kind="word"))
    db_session.add(Card(word="banana", meaning="香蕉", kind="word"))
    db_session.commit()

    resp = client.get("/api/cards")
    cards = resp.json()["cards"]
    assert len(cards) == 2
    for c in cards:
        assert c["review_count"] == 0
        assert c["graduated"] is False


MOCK_GENERATE_RESPONSE = '{"cards": [{"word": "pear", "phonetic": "/per/", "meaning": "梨", "example": "I eat a pear.", "example_cn": "我吃一个梨。"}]}'


@patch("app.services.card_generator.client")
def test_generate_cards(mock_client, client, db_session):
    """POST /api/cards/generate 生成词卡并返回。"""
    mock_resp = type(
        "Resp",
        (),
        {
            "choices": [
                type(
                    "Choice",
                    (),
                    {"message": type("Msg", (), {"content": MOCK_GENERATE_RESPONSE})()},
                )()
            ]
        },
    )()
    mock_client.chat.completions.create.return_value = mock_resp

    resp = client.post("/api/cards/generate", json={"words": ["pear"]})
    assert resp.status_code == 200
    data = resp.json()
    assert data["generated"] == 1
    assert data["skipped"] == 0
    assert data["cards"][0]["word"] == "pear"


def test_generate_cards_empty_words(client):
    """空单词列表 → 422。"""
    resp = client.post("/api/cards/generate", json={"words": []})
    assert resp.status_code == 422


def test_generate_cards_already_exists(client, db_session):
    """已存在的词跳过，不重复生成。"""
    db_session.add(Card(word="pear", meaning="梨", kind="word"))
    db_session.commit()

    with patch("app.services.card_generator.client") as mock_client:
        # 如果走到 API 调用，这里返回空 cards —— 应被 existing 过滤拦截
        mock_resp = type(
            "Resp",
            (),
            {
                "choices": [
                    type(
                        "Choice",
                        (),
                        {"message": type("Msg", (), {"content": '{"cards": []}'})()},
                    )()
                ]
            },
        )()
        mock_client.chat.completions.create.return_value = mock_resp
        resp = client.post("/api/cards/generate", json={"words": ["pear"]})

    assert resp.status_code == 200
    assert resp.json()["generated"] == 0
    assert resp.json()["skipped"] == 1
    # generate_cards 对全新词调 API；已存在词直接跳过（不会 mock 到调用）
    mock_client.chat.completions.create.assert_not_called()


def test_get_card_detail_not_found(client):
    """不存在的卡 → 404。"""
    resp = client.get("/api/cards/999")
    assert resp.status_code == 404


def test_get_card_detail_basic(client, db_session):
    """单词详情：返回全部字段 + 空复习历史。"""
    db_session.add(
        Card(
            word="hello",
            phonetic="/həˈloʊ/",
            meaning="你好",
            example="Hello, how are you?",
            example_cn="你好，你怎么样？",
            explanation="greeting",
            kind="word",
        )
    )
    db_session.commit()

    resp = client.get("/api/cards/1")
    assert resp.status_code == 200
    data = resp.json()
    assert data["word"] == "hello"
    assert data["phonetic"] == "/həˈloʊ/"
    assert data["meaning"] == "你好"
    assert data["explanation"] == "greeting"
    assert data["graduated"] is False
    assert data["review_count"] == 0
    assert data["next_due"] is None
    assert data["review_history"] == []


def test_get_card_detail_with_reviews(client, db_session):
    """单词详情：含复习历史。"""
    card = Card(word="world", meaning="世界", kind="word")
    db_session.add(card)
    db_session.flush()

    # 模拟两次复习
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    db_session.add(
        Review(
            card_id=card.id,
            state=1,
            due=now + timedelta(days=1),
            stability=2.5,
            difficulty=0.3,
            elapsed_days=0,
            last_review=now - timedelta(hours=2),
            review_count=1,
        )
    )
    db_session.add(
        Review(
            card_id=card.id,
            state=3,
            due=now + timedelta(days=7),
            stability=5.0,
            difficulty=0.2,
            elapsed_days=1,
            last_review=now,
            review_count=2,
        )
    )
    db_session.commit()

    resp = client.get(f"/api/cards/{card.id}")
    data = resp.json()
    assert data["graduated"] is True  # state==3
    assert data["review_count"] == 2
    assert data["next_due"] is not None
    assert len(data["review_history"]) == 2


def test_update_card(client, db_session):
    """编辑词卡：只更新提供的字段。"""
    db_session.add(Card(word="apple", meaning="苹果", example="I eat an apple.", kind="word"))
    db_session.commit()
    resp = client.put("/api/cards/1", json={"meaning": "苹果（水果）", "example": "The red apple fell down."})
    assert resp.status_code == 200
    data = resp.json()
    assert data["meaning"] == "苹果（水果）"
    assert data["example"] == "The red apple fell down."


def test_delete_card_cascades(client, db_session):
    """删除词卡：级联清 reviews/memos。"""
    from datetime import datetime, timezone

    from app.models.memo import Memo
    from app.models.review import Review
    card = Card(word="apple", meaning="苹果", kind="word")
    db_session.add(card)
    db_session.commit()
    db_session.refresh(card)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    db_session.add(Review(card_id=card.id, state=1, due=now, stability=1.0, difficulty=1.0, elapsed_days=0, last_review=now, review_count=1))
    db_session.add(Memo(card_id=card.id, content="谐音记忆"))
    db_session.commit()
    resp = client.delete(f"/api/cards/{card.id}")
    assert resp.status_code == 200
    assert db_session.query(Review).filter_by(card_id=card.id).count() == 0
    assert db_session.query(Memo).filter_by(card_id=card.id).count() == 0


def test_update_card_not_found(client):
    resp = client.put("/api/cards/999", json={"meaning": "x"})
    assert resp.status_code == 404
