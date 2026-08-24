"""课程 API 测试（mock AI 生成）。"""

from unittest.mock import patch

from app.models.lesson import Lesson

MOCK_LESSON_RESPONSE = (
    '{"title": "Hello 你好", "words": [{"word": "hello", "phonetic": "/həˈloʊ/",'
    ' "meaning": "你好", "example": "Hello, my friend.", "example_cn": "你好，我的朋友。"},'
    ' {"word": "hi", "phonetic": "/haɪ/", "meaning": "嗨", "example": "Hi there.",'
    ' "example_cn": "嗨，你好。"}], "dialogue": [{"speaker": "A", "en": "Hello!",'
    ' "cn": "你好！"}, {"speaker": "B", "en": "Hi!", "cn": "嗨！"}],'
    ' "tips": ["hello 和 hi 都表示你好"]}'
)


def _mock_client_resp(mock_client):
    mock_resp = type(
        "Resp",
        (),
        {
            "choices": [
                type(
                    "Choice",
                    (),
                    {"message": type("Msg", (), {"content": MOCK_LESSON_RESPONSE})()},
                )()
            ]
        },
    )()
    mock_client.chat.completions.create.return_value = mock_resp


def test_lessons_empty(client):
    """无课程 → next_level=1。"""
    resp = client.get("/api/lessons")
    assert resp.status_code == 200
    data = resp.json()
    assert data["lessons"] == []
    assert data["next_level"] == 1
    assert data["is_done"] is False


@patch("app.services.lesson_generator.client")
def test_create_next_lesson(mock_client, client):
    """生成第一课：level=1，词落 cards。"""
    _mock_client_resp(mock_client)
    resp = client.post("/api/lessons/next")
    assert resp.status_code == 200
    data = resp.json()
    assert data["level"] == 1
    assert data["title"] == "Hello 你好"
    assert len(data["content"]["words"]) == 2
    assert len(data["content"]["dialogue"]) == 2


@patch("app.services.lesson_generator.client")
def test_lesson_progression(mock_client, client, db_session):
    """连续生成：level 依次 1→2。"""
    _mock_client_resp(mock_client)
    r1 = client.post("/api/lessons/next").json()
    r2 = client.post("/api/lessons/next").json()
    assert r1["level"] == 1
    assert r2["level"] == 2
    # 列表显示两课 + next_level=3
    data = client.get("/api/lessons").json()
    assert len(data["lessons"]) == 2
    assert data["next_level"] == 3


def test_get_lesson_not_found(client):
    """读不存在的课 → 404。"""
    resp = client.get("/api/lessons/99")
    assert resp.status_code == 404


@patch("app.services.lesson_generator.client")
def test_get_lesson_with_card_ids(mock_client, client):
    """读课程 → content + card_ids。"""
    _mock_client_resp(mock_client)
    client.post("/api/lessons/next")
    resp = client.get("/api/lessons/1")
    data = resp.json()
    assert "card_ids" in data
    assert "hello" in data["card_ids"]


def test_lessons_all_done(client, db_session):
    """20 级全学完 → is_done + 再生成 400。"""
    db_session.add(Lesson(level=20, title="最后一课", content={"words": []}))
    db_session.commit()
    resp = client.get("/api/lessons")
    assert resp.json()["next_level"] == 20
    assert resp.json()["is_done"] is True
    # 再生成（max_level 20）→ 400
    r2 = client.post("/api/lessons/next")
    assert r2.status_code == 400
