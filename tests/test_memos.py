"""记忆法（自我解释）API 测试。"""

from app.models.card import Card
from app.models.memo import Memo


def _add_word(db, word="apple"):
    c = Card(word=word, meaning=f"{word}的意思", kind="word")
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


def test_get_memo_empty(client, db_session):
    """无记忆法 → content None。"""
    card = _add_word(db_session)
    resp = client.get(f"/api/memos/{card.id}")
    assert resp.status_code == 200
    assert resp.json()["content"] is None


def test_save_and_get_memo(client, db_session):
    """保存记忆法 → 可读回。"""
    card = _add_word(db_session)
    resp = client.put(f"/api/memos/{card.id}", json={"content": "apple 谐音 爱的破"})
    assert resp.status_code == 200
    assert resp.json()["content"] == "apple 谐音 爱的破"
    resp = client.get(f"/api/memos/{card.id}")
    assert resp.json()["content"] == "apple 谐音 爱的破"


def test_memo_upsert(client, db_session):
    """保存两次 → 覆盖，单条记录。"""
    card = _add_word(db_session)
    client.put(f"/api/memos/{card.id}", json={"content": "第一版"})
    client.put(f"/api/memos/{card.id}", json={"content": "第二版"})
    resp = client.get(f"/api/memos/{card.id}")
    assert resp.json()["content"] == "第二版"
    rows = db_session.query(Memo).filter_by(card_id=card.id).all()
    assert len(rows) == 1


def test_memo_card_not_found(client):
    """不存在的卡 → 404。"""
    resp = client.put("/api/memos/999", json={"content": "x"})
    assert resp.status_code == 404


def test_memo_empty_content(client, db_session):
    """空内容 → 422。"""
    card = _add_word(db_session)
    resp = client.put(f"/api/memos/{card.id}", json={"content": ""})
    assert resp.status_code == 422
