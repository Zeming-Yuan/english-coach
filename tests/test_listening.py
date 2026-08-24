"""听写练习 API 测试。"""

from datetime import datetime, timedelta, timezone

from app.models.card import Card
from app.models.review import Review


def test_listening_empty(client):
    """空库 → 空题目。"""
    resp = client.get("/api/listening")
    assert resp.status_code == 200
    assert resp.json()["questions"] == []


def test_listening_new_cards(client, db_session):
    """新词（无 Review）→ 生成听写题。"""
    for w in ["apple", "banana", "cat", "dog", "egg", "fish", "grape", "hat"]:
        db_session.add(Card(word=w, meaning=f"{w}的意思", kind="word"))
    db_session.commit()

    resp = client.get("/api/listening?limit=3")
    data = resp.json()
    assert len(data["questions"]) == 3
    for q in data["questions"]:
        assert len(q["options"]) >= 2  # 至少正确+1干扰
        assert q["options"][q["correct_index"]] == q["word"]
        assert q["meaning"] is not None


def test_listening_due_cards(client, db_session):
    """到期卡 → 生成听写题。"""
    card = Card(word="hello", meaning="你好", kind="word")
    db_session.add(card)
    db_session.flush()
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    db_session.add(
        Review(
            card_id=card.id,
            state=1,
            due=now - timedelta(hours=1),
            stability=2.5,
            difficulty=0.3,
            elapsed_days=0,
            last_review=now - timedelta(days=1),
            review_count=1,
        )
    )
    db_session.commit()

    resp = client.get("/api/listening")
    data = resp.json()
    assert len(data["questions"]) == 1
    assert data["questions"][0]["word"] == "hello"


def test_listening_only_word_kind(client, db_session):
    """句子卡不进听写题。"""
    db_session.add(Card(word="hello", meaning="你好", kind="word"))
    db_session.add(Card(word="I am fine", meaning="我很好", kind="sentence"))
    db_session.commit()

    resp = client.get("/api/listening")
    data = resp.json()
    assert len(data["questions"]) == 1
    assert data["questions"][0]["word"] == "hello"


def test_listening_score_correct(client, db_session):
    """听写评分：选对 + FSRS 记录。"""
    card = Card(word="world", meaning="世界", kind="word")
    db_session.add(card)
    db_session.commit()

    resp = client.post(
        "/api/listening/score",
        json={
            "card_id": card.id,
            "selected_index": 2,
            "correct_index": 2,
            "rating": 3,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["correct"] is True
    assert data["correct_word"] == "world"
    assert data["next_due"] is not None


def test_listening_score_wrong(client, db_session):
    """听写评分：选错。"""
    card = Card(word="hello", meaning="你好", kind="word")
    db_session.add(card)
    db_session.commit()

    resp = client.post(
        "/api/listening/score",
        json={
            "card_id": card.id,
            "selected_index": 0,
            "correct_index": 3,
            "rating": 1,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["correct"] is False
    assert data["correct_word"] == "hello"


def test_listening_score_card_not_found(client):
    """不存在的卡 → 404。"""
    resp = client.post(
        "/api/listening/score",
        json={"card_id": 999, "selected_index": 0, "correct_index": 0, "rating": 3},
    )
    assert resp.status_code == 404
