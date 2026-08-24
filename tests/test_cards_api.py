"""词卡 API 测试（生成端点 mock AI）。"""

from unittest.mock import patch

from app.models.card import Card


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
                type("Choice", (), {"message": type("Msg", (), {"content": MOCK_GENERATE_RESPONSE})()})()
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
                    type("Choice", (), {"message": type("Msg", (), {"content": '{"cards": []}'})()})()
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
