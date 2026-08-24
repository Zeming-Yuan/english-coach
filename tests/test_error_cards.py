"""错词追踪（错误增强效应）测试。"""

from app.models.card import Card
from app.models.error_card import ErrorCard


def _add_word(db, word="apple"):
    c = Card(word=word, meaning=f"{word}的意思", kind="word")
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


def test_review_wrong_weights_error(client, db_session):
    """评分 1（忘了）→ 错词入库 error_count=1。"""
    card = _add_word(db_session)
    resp = client.post("/api/reviews", json={"card_id": card.id, "rating": 1})
    assert resp.status_code == 200
    row = db_session.query(ErrorCard).filter_by(card_id=card.id).first()
    assert row is not None
    assert row.error_count == 1


def test_review_correct_reduces_error(client, db_session):
    """先错后对 → error_count 归零删除。"""
    card = _add_word(db_session)
    client.post("/api/reviews", json={"card_id": card.id, "rating": 1})  # 错
    client.post("/api/reviews", json={"card_id": card.id, "rating": 3})  # 对
    row = db_session.query(ErrorCard).filter_by(card_id=card.id).first()
    assert row is None or row.error_count <= 0


def test_typing_check_wrong_weights(client, db_session):
    """测验判分答错 → 错词入库。"""
    card = _add_word(db_session, word="banana")
    resp = client.post(
        "/api/typing/check", json={"card_id": card.id, "user_input": "banan"}
    )
    assert resp.status_code == 200
    assert resp.json()["correct"] is False
    row = db_session.query(ErrorCard).filter_by(card_id=card.id).first()
    assert row is not None
    assert row.error_count == 1


def test_typing_check_correct_no_error(client, db_session):
    """测验判分答对 → 不产生错词。"""
    card = _add_word(db_session, word="banana")
    client.post("/api/typing/check", json={"card_id": card.id, "user_input": "Banana"})
    row = db_session.query(ErrorCard).filter_by(card_id=card.id).first()
    assert row is None


def test_listening_wrong_weights(client, db_session):
    """听写答错 → 错词入库。"""
    card = _add_word(db_session)
    client.post(
        "/api/listening/score",
        json={
            "card_id": card.id,
            "selected_index": 0,
            "correct_index": 3,
            "rating": 1,
        },
    )
    row = db_session.query(ErrorCard).filter_by(card_id=card.id).first()
    assert row is not None


def test_today_error_cards_first(client, db_session):
    """错词卡在 /api/today 的 error_cards 列表里。"""
    card = _add_word(db_session)
    client.post("/api/reviews", json={"card_id": card.id, "rating": 1})
    resp = client.get("/api/today")
    data = resp.json()
    assert len(data["error_cards"]) == 1
    assert data["error_cards"][0]["id"] == card.id


def test_errors_endpoint(client, db_session):
    """GET /api/errors 错词本。"""
    card = _add_word(db_session)
    client.post("/api/reviews", json={"card_id": card.id, "rating": 1})
    client.post("/api/reviews", json={"card_id": card.id, "rating": 2})
    resp = client.get("/api/errors")
    assert resp.status_code == 200
    errs = resp.json()["errors"]
    assert len(errs) == 1
    assert errs[0]["card_id"] == card.id
    assert errs[0]["error_count"] == 2
    assert errs[0]["word"] == card.word


def test_toggle_hard(client, db_session):
    """困难词切换：标记→队列优先→取消。"""
    from app.models.hard_card import HardCard
    card = _add_word(db_session, word="difficult-word")
    # 标记
    resp = client.post(f"/api/cards/{card.id}/hard")
    assert resp.status_code == 200
    assert resp.json()["is_hard"] is True
    assert db_session.query(HardCard).filter_by(card_id=card.id).count() == 1
    # 队列优先
    today = client.get("/api/today").json()
    assert len(today["error_cards"]) >= 1
    assert any(c["id"] == card.id for c in today["error_cards"])
    # 取消
    resp = client.post(f"/api/cards/{card.id}/hard")
    assert resp.json()["is_hard"] is False
    assert db_session.query(HardCard).filter_by(card_id=card.id).count() == 0
