"""难度自适应测试：近 7 天正确率调每日新词量。"""

from datetime import datetime, timedelta, timezone

from app.models.card import Card
from app.models.review import Review


def _seed_reviews(db, wrong_count, right_count):
    """造近 7 天复习记录（state==2 视为错，state==3 视为对）。"""
    card = Card(word="apple", meaning="苹果", kind="word")
    db.add(card)
    db.commit()
    db.refresh(card)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    for i in range(wrong_count + right_count):
        is_wrong = i < wrong_count
        db.add(
            Review(
                card_id=card.id,
                state=2 if is_wrong else 3,
                due=now + timedelta(days=1),
                stability=2.0,
                difficulty=0.3,
                elapsed_days=0,
                last_review=now - timedelta(hours=i),
                review_count=i + 1,
            )
        )
    db.commit()


def test_no_data_default(client, db_session):
    """无复习数据 → 默认 10。"""
    card = Card(word="apple", meaning="苹果", kind="word")
    db_session.add(card)
    db_session.commit()
    resp = client.get("/api/today")
    assert resp.status_code == 200
    assert len(resp.json()["new_cards"]) <= 10


def test_high_error_rate_limits_to_5(client, db_session):
    """错误率高（>30%）→ 新词量降至 5。"""
    _seed_reviews(db_session, wrong_count=4, right_count=6)  # 40% 错
    resp = client.get("/api/today")
    assert len(resp.json()["new_cards"]) <= 5


def test_low_error_rate_raises_to_15(client, db_session):
    """错误率低（<15%）→ 新词量升至 15。"""
    _seed_reviews(db_session, wrong_count=1, right_count=9)  # 10% 错
    # 造 20 个新词，验证能取到 15
    for w in ["w1", "w2", "w3", "w4", "w5", "w6", "w7", "w8", "w9", "w10",
              "w11", "w12", "w13", "w14", "w15", "w16", "w17", "w18", "w19", "w20"]:
        db_session.add(Card(word=w, meaning=f"{w}的意思", kind="word"))
    db_session.commit()
    resp = client.get("/api/today")
    assert len(resp.json()["new_cards"]) == 15


def test_mid_error_rate_keeps_default(client, db_session):
    """错误率适中 → 保持 10。"""
    _seed_reviews(db_session, wrong_count=2, right_count=8)  # 20% 错
    resp = client.get("/api/today")
    assert len(resp.json()["new_cards"]) <= 10
