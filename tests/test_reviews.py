from datetime import datetime, timezone

from sqlalchemy import select

from app.models.card import Card
from app.models.review import Review


def make_card(db, word="apple"):
    card = Card(word=word)
    db.add(card)
    db.commit()
    return card


def submit(client, card_id, rating):
    """POST /api/reviews 封装"""
    return client.post("/api/reviews", json={"card_id": card_id, "rating": rating})


def get_review(db, card_id):
    """查该卡最新 review 记录"""
    return (
        db.execute(
            select(Review).where(Review.card_id == card_id).order_by(Review.id.desc())
        )
        .scalars()
        .first()
    )


def test_new_card_first_review(client, db_session):
    """① 新卡首评：入库一条 Learning 记录，next_due 在未来"""
    card = make_card(db_session)
    resp = submit(client, card.id, 3)
    assert resp.status_code == 200

    data = resp.json()
    assert data["card_id"] == card.id
    assert datetime.fromisoformat(data["next_due"]) > datetime.now(timezone.utc)

    review = get_review(db_session, card.id)
    assert review.review_count == 1
    assert review.state == 1  # Learning


def test_review_progression(client, db_session):
    """② 连续复习：Good×2 走完学习步骤 → 毕业进 Review"""
    card = make_card(db_session)
    submit(client, card.id, 3)  # 首评
    resp = submit(client, card.id, 3)  # Good
    assert resp.status_code == 200

    review = get_review(db_session, card.id)
    assert review.review_count == 2
    assert review.state == 2  # Review


def test_card_not_found(client, db_session):
    """③ 卡不存在：返回 404"""
    resp = submit(client, 999, 3)
    assert resp.status_code == 404


def test_invalid_rating(client, db_session):
    """④ 非法评分 → 422（pydantic Literal 自动拦）"""
    card = make_card(db_session)
    resp = submit(client, card.id, 5)  # 5 不在 Literal[1,2,3,4] 中
    assert resp.status_code == 422


def test_review_graduates_word_to_sentence(client, db_session):
    """复习 3 次 → 词卡毕业 → 响应含 graduated + sentence_card_id。"""
    card = Card(
        word="hello",
        phonetic="/həˈloʊ/",
        meaning="你好",
        example="Hello, how are you?",
        example_cn="你好，怎么样？",
        kind="word",
    )
    db_session.add(card)
    db_session.commit()
    db_session.refresh(card)
    # 提交 3 次复习（每次 rating=3=Good）
    for _ in range(3):
        resp = client.post("/api/reviews", json={"card_id": card.id, "rating": 3})
    assert resp.status_code == 200  # type: ignore
    data = resp.json()  # type: ignore
    assert data["graduated"] is True
    assert "sentence_card_id" in data
    # 验证句子卡确实入库了
    sentence = db_session.get(Card, data["sentence_card_id"])
    assert sentence.kind == "sentence"
    assert sentence.meaning == "你好，怎么样？"
