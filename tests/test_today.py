from datetime import datetime, timedelta

from app.models.card import Card
from app.models.review import Review


def make_card(db, word="apple"):
    card = Card(word=word)
    db.add(card)
    db.commit()
    return card


def make_review(db, card, due):
    db.add(
        Review(
            card_id=card.id,
            state=0,
            due=due,
            stability=1.0,
            difficulty=5.0,
            elapsed_days=0,
            review_count=1,
        )
    )
    db.commit()


def test_only_new_cards(client, db_session):
    # 创建 3 个新单词
    for word in ["apple", "banana", "cherry"]:
        make_card(db_session, word)
    resp = client.get("/api/today")
    data = resp.json()
    assert resp.status_code == 200
    assert [c["word"] for c in data["new_cards"]] == ["apple", "banana", "cherry"]
    assert data["due_cards"] == []


def test_none_cards(client, db_session):
    resp = client.get("/api/today")
    data = resp.json()
    assert resp.status_code == 200
    assert data["new_cards"] == []
    assert data["due_cards"] == []


def test_only_due_cards(client, db_session):
    # 创建 3 个单词，并为它们创建 Review，设置 due 时间为过去
    for word, days in [("apple", 3), ("banana", 1), ("cherry", 2)]:
        card = make_card(db_session, word)
        make_review(db_session, card, due=datetime.now() - timedelta(days=days))  # noqa:  DTZ005
    resp = client.get("/api/today")
    data = resp.json()
    assert resp.status_code == 200
    assert data["new_cards"] == []
    assert [c["word"] for c in data["due_cards"]] == ["apple", "cherry", "banana"]


def test_limit_cards(client, db_session):
    # 创建 5 个新单词
    for word in ["apple", "banana", "cherry", "date", "elderberry"]:
        make_card(db_session, word)
    resp = client.get("/api/today", params={"new_limit": 2})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["new_cards"]) == 2

def test_old_card_without_contexts(client,db_session):
    make_card(db_session,"apple")
    resp = client.get("/api/today")
    data = resp.json()
    assert data["new_cards"][0]["contexts"] is None