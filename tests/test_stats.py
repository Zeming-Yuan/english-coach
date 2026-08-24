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
    db_session.add_all(
        [
            Review(
                card_id=card1.id,
                state=1,
                due=now,
                stability=1.0,
                difficulty=1.0,
                elapsed_days=0,
                last_review=now,
                review_count=1,
            ),
            Review(
                card_id=card1.id,
                state=3,
                due=now + timedelta(days=1),
                stability=2.0,
                difficulty=1.0,
                elapsed_days=0,
                last_review=now,
                review_count=2,
            ),
        ]
    )
    # card2 昨天复习过 1 次（不算今天）
    db_session.add(
        Review(
            card_id=card2.id,
            state=1,
            due=now,
            stability=1.0,
            difficulty=1.0,
            elapsed_days=0,
            last_review=now - timedelta(days=1),
            review_count=1,
        )
    )
    db_session.commit()

    resp = client.get("/api/stats")
    data = resp.json()
    assert data["reviewed_today"] == 2  # 只算今天的 2 次
    assert data["total_cards"] == 2
    assert data["graduated"] == 1  # state==3 的一条
    assert data["streak"] == 2  # 今天+昨天都学过 → 2 天


def test_streak_consecutive_days(client, db_session):
    """连续 3 天学习 → streak=3。"""
    card = Card(word="apple", meaning="苹果", kind="word")
    db_session.add(card)
    db_session.commit()
    db_session.refresh(card)

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    for i in range(3):
        db_session.add(
            Review(
                card_id=card.id,
                state=1,
                due=now,
                stability=1.0,
                difficulty=1.0,
                elapsed_days=0,
                last_review=now - timedelta(days=i),
                review_count=i + 1,
            )
        )
    db_session.commit()

    resp = client.get("/api/stats")
    assert resp.json()["streak"] == 3


def test_streak_broken_yesterday(client, db_session):
    """昨天没学 → streak=0（中断）。"""
    card = Card(word="apple", meaning="苹果", kind="word")
    db_session.add(card)
    db_session.commit()
    db_session.refresh(card)

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    # 前天学过，昨天没学
    db_session.add(
        Review(
            card_id=card.id,
            state=1,
            due=now,
            stability=1.0,
            difficulty=1.0,
            elapsed_days=0,
            last_review=now - timedelta(days=2),
            review_count=1,
        )
    )
    db_session.commit()

    resp = client.get("/api/stats")
    assert resp.json()["streak"] == 0


def test_streak_today_missed_but_yesterday_ok(client, db_session):
    """今天还没学但昨天学过 → streak 保留（从昨天算）。"""
    card = Card(word="apple", meaning="苹果", kind="word")
    db_session.add(card)
    db_session.commit()
    db_session.refresh(card)

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    for i in range(1, 4):  # 昨天、前天、大前天
        db_session.add(
            Review(
                card_id=card.id,
                state=1,
                due=now,
                stability=1.0,
                difficulty=1.0,
                elapsed_days=0,
                last_review=now - timedelta(days=i),
                review_count=i,
            )
        )
    db_session.commit()

    resp = client.get("/api/stats")
    assert resp.json()["streak"] == 3
