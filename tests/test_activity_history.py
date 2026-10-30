"""EC-08：学习活动历史、学习日与连续天数按不可变事件读取。"""

from datetime import datetime
from uuid import uuid4

import pytest

from app.runtime import Runtime
from app.services.statistics import learning_day


def _dt(*args) -> datetime:
    """旧 reviews/review_baselines 表使用 naive UTC。"""
    return datetime(*args)  # noqa: DTZ001


@pytest.mark.parametrize(
    ("iso", "zone", "expected"),
    [
        ("2026-10-29T15:59:59+00:00", "Asia/Shanghai", "2026-10-29"),
        ("2026-10-29T16:00:00+00:00", "Asia/Shanghai", "2026-10-30"),
        ("2026-10-29T16:00:00+00:00", "UTC", "2026-10-29"),
        ("2026-10-30T23:00:00+00:00", "Asia/Shanghai", "2026-10-31"),
        ("2026-10-30T00:00:00+00:00", "Asia/Shanghai", "2026-10-30"),
    ],
)
def test_learning_day_review_focus(iso, zone, expected):
    assert learning_day(datetime.fromisoformat(iso), zone) == expected


def _review(ec, card_id: int, rating: int, submission_id: str | None = None):
    return ec.client.post(
        "/api/reviews",
        json={
            "card_id": card_id,
            "rating": rating,
            "source": "study",
            "kind": "self_rating",
            "submission_id": submission_id or str(uuid4()),
        },
    )


def test_three_days_on_one_card_remain_visible(ec):
    card_id = ec.seed_card()
    for day, rating in [("28", 1), ("29", 3), ("30", 4)]:
        ec.set_time(f"2026-10-{day}T01:00:00+00:00")
        assert _review(ec, card_id, rating).status_code == 200

    days = ec.client.get("/api/stats/history?days=4").json()["days"]
    counts = {row["date"]: row["reviews"] for row in days}
    assert [counts[f"2026-10-{day}"] for day in ["28", "29", "30"]] == [1, 1, 1]
    assert ec.client.get("/api/stats").json()["streak"] == 3


def test_same_day_attempts_and_retry_counts(ec):
    card_id = ec.seed_card()
    ec.set_time("2026-10-30T01:00:00+00:00")
    first_id = str(uuid4())
    payload = {
        "card_id": card_id,
        "rating": 3,
        "source": "study",
        "kind": "self_rating",
        "submission_id": first_id,
    }
    assert ec.client.post("/api/reviews", json=payload).status_code == 200
    assert ec.client.post("/api/reviews", json=payload).status_code == 200
    payload["submission_id"] = str(uuid4())
    assert ec.client.post("/api/reviews", json=payload).status_code == 200

    stats = ec.client.get("/api/stats").json()
    assert stats["reviewed_today"] == 1
    assert stats["attempted_today"] == 2
    assert stats["skipped_today"] == 0


def test_streak_keeps_yesterday_when_today_empty(ec):
    card_id = ec.seed_card()
    ec.set_time("2026-10-29T01:00:00+00:00")
    assert _review(ec, card_id, 3).status_code == 200
    ec.set_time("2026-10-30T01:00:00+00:00")
    assert ec.client.get("/api/stats").json()["streak"] == 1


def test_legacy_baseline_does_not_fake_calendar(ec):
    from app.models.review import Review
    from app.models.review_baseline import ReviewBaseline

    card_id = ec.seed_card()
    db = ec.SessionLocal()
    try:
        db.add(
            Review(
                card_id=card_id,
                state=2,
                step=0,
                due=_dt(2026, 10, 30),
                stability=5.0,
                difficulty=5.0,
                elapsed_days=0,
                review_count=10,
                last_review=_dt(2026, 10, 20),
            )
        )
        db.add(
            ReviewBaseline(
                id=str(uuid4()),
                card_id=card_id,
                source_kind="migration",
                raw={"review_count": 10},
                selected=True,
                captured_at=_dt(2026, 10, 30),
                last_activity=_dt(2026, 10, 20),
                cumulative_count=10,
                source_fingerprint="f" * 64,
            )
        )
        db.commit()
    finally:
        db.close()

    ec.set_time("2026-10-30T01:00:00+00:00")
    stats = ec.client.get("/api/stats").json()
    assert stats["history_incomplete"] is True
    assert stats["reviewed_today"] == 0
    assert stats["streak"] == 0
    days = ec.client.get("/api/stats/history?days=3").json()["days"]
    assert all(row["reviews"] == 0 for row in days)


def test_timezone_change_does_not_repartition_stored_events(ec):
    card_id = ec.seed_card()
    # UTC 10-29 16:30 = 上海 10-30 00:30，学习日必须记为 10-30。
    ec.set_time("2026-10-29T16:30:00+00:00")
    assert _review(ec, card_id, 3).status_code == 200

    before = ec.client.get("/api/stats/history?days=1").json()["days"]
    assert {row["date"]: row["reviews"] for row in before}["2026-10-30"] == 1

    ec.app.state.runtime = Runtime(ec.clock, "UTC")
    # 事件写入时已固定学习日；切换时区不回写、不重分历史。
    detail = ec.client.get(f"/api/cards/{card_id}").json()
    assert detail["learning_events"][0]["learning_day"] == "2026-10-30"
    assert detail["learning_events"][0]["learning_timezone"] == "Asia/Shanghai"
    assert ec.client.get("/api/stats").json()["reviewed_today"] == 0
