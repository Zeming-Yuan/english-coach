"""学习统计 API 测试。"""

from datetime import datetime, timedelta, timezone

from app.models.card import Card
from app.models.review import Review


def test_stats_empty(client, db_session):
    """空库统计。"""
    resp = client.get("/api/stats")
    data = resp.json()
    assert data["reviewed_today"] == 0
    assert data["total_cards"] == 0
    assert data["graduated"] == 0


def test_stats_counts(client, db_session):
    """统计今日复习/总数/毕业数。"""
    card1 = Card(word="apple", meaning="苹果", kind="word")
    card2 = Card(word="banana", meaning="香蕉", kind="word")
    db_session.add_all([card1, card2])
    db_session.commit()
    db_session.refresh(card1)
    db_session.refresh(card2)

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    # card1 今天复习过 2 次
    db_session.add_all([
        Review(card_id=card1.id, state=1, due=now, stability=1.0,
               difficulty=1.0, elapsed_days=0, last_review=now,
               review_count=1),
        Review(card_id=card1.id, state=3, due=now + timedelta(days=1), stability=2.0,
               difficulty=1.0, elapsed_days=0, last_review=now,
               review_count=2),
    ])
    # card2 昨天复习过 1 次（不算今天）
    db_session.add(Review(
        card_id=card2.id, state=1, due=now, stability=1.0,
        difficulty=1.0, elapsed_days=0,
        last_review=now - timedelta(days=1), review_count=1,
    ))
    db_session.commit()

    resp = client.get("/api/stats")
    data = resp.json()
    assert data["reviewed_today"] == 2  # 只算今天的 2 次
    assert data["total_cards"] == 2
    assert data["graduated"] == 1  # state==3 的一条
