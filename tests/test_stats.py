"""学习统计 API 测试：按不可变事件聚合。"""

from uuid import uuid4


def _review(ec, card_id, rating=3, at=None):
    if at is not None:
        ec.set_time(at)
    return ec.client.post(
        "/api/reviews",
        json={
            "card_id": card_id,
            "rating": rating,
            "source": "study",
            "kind": "self_rating",
            "submission_id": str(uuid4()),
        },
    )


def test_stats_empty(client):
    """空库统计。"""
    data = client.get("/api/stats").json()
    assert data["reviewed_today"] == 0
    assert data["attempted_today"] == 0
    assert data["skipped_today"] == 0
    assert data["total_cards"] == 0
    assert data["graduated"] == 0
    assert data["history_incomplete"] is False


def test_stats_counts(ec):
    """完成词按卡去重，练习次数按真实作答事件计。"""
    card1 = ec.seed_card("apple")
    card2 = ec.seed_card("banana")
    for _ in range(3):
        assert _review(ec, card1, at="2026-10-30T01:00:00+00:00").status_code == 200
    assert _review(ec, card2, at="2026-10-29T01:00:00+00:00").status_code == 200
    ec.set_time("2026-10-30T01:00:00+00:00")

    data = ec.client.get("/api/stats").json()
    assert data["reviewed_today"] == 1  # 同一张卡多次只算 1 个完成词
    assert data["attempted_today"] == 3  # 今天 3 次真实作答
    assert data["total_cards"] == 2
    assert data["graduated"] == 1  # card1 复习 3 次毕业
    assert data["streak"] == 2  # 今天 + 昨天


def test_streak_consecutive_days(ec):
    card_id = ec.seed_card("apple")
    for day in ["28", "29", "30"]:
        assert _review(ec, card_id, at=f"2026-10-{day}T01:00:00+00:00").status_code == 200
    ec.set_time("2026-10-30T01:00:00+00:00")
    assert ec.client.get("/api/stats").json()["streak"] == 3


def test_streak_broken_yesterday(ec):
    card_id = ec.seed_card("apple")
    assert _review(ec, card_id, at="2026-10-28T01:00:00+00:00").status_code == 200
    ec.set_time("2026-10-30T01:00:00+00:00")
    assert ec.client.get("/api/stats").json()["streak"] == 0


def test_streak_today_missed_but_yesterday_ok(ec):
    card_id = ec.seed_card("apple")
    for day in ["27", "28", "29"]:
        assert _review(ec, card_id, at=f"2026-10-{day}T01:00:00+00:00").status_code == 200
    ec.set_time("2026-10-30T01:00:00+00:00")
    assert ec.client.get("/api/stats").json()["streak"] == 3


def test_stats_history_empty(client):
    """空库历史 → 全 0。"""
    data = client.get("/api/stats/history?days=7").json()
    assert len(data["days"]) == 8  # 7+1 天
    for day in data["days"]:
        assert day["reviews"] == 0
        assert day["reviewed_words"] == 0
        assert day["skipped"] == 0
        assert day["new_cards"] == 0


def test_stats_history_with_data(ec):
    card_id = ec.seed_card("test")
    for _ in range(2):
        assert _review(ec, card_id, at="2026-10-30T01:00:00+00:00").status_code == 200
    ec.set_time("2026-10-30T01:00:00+00:00")

    days = ec.client.get("/api/stats/history?days=3").json()["days"]
    assert len(days) == 4
    today = next(day for day in days if day["date"] == "2026-10-30")
    assert today["reviews"] == 2  # 两次真实作答
    assert today["reviewed_words"] == 1  # 完成词按卡去重
    assert today["new_cards"] == 1  # 该卡第一条排期事件
