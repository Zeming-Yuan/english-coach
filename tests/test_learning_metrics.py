"""EC-09：分类指标与基于合格首答的自适应新词建议。"""

from datetime import datetime, timezone
from uuid import uuid4

import pytest

from app.services.statistics import adaptive_new_limit, metric, review_pass_rate


def _event(index: int, **overrides) -> dict:
    event = {
        "event_id": f"e{index}",
        "card_id": index,
        "learning_day": "2026-10-30",
        "occurred_at": datetime(2026, 10, 30, 1, 0, index, tzinfo=timezone.utc),
        "source": "study",
        "kind": "self_rating",
        "assistance": [],
        "correct": None,
        "skipped": False,
        "scheduled": True,
        "fsrs_rating": 3,
        "self_rating": 3,
    }
    event.update(overrides)
    return event


@pytest.mark.parametrize(
    ("count", "wrong", "limit"),
    [(0, 0, 10), (19, 0, 10), (20, 0, 15), (20, 3, 10), (20, 6, 10), (20, 7, 5)],
)
def test_adaptive_review_focus(count, wrong, limit):
    events = [
        _event(
            index,
            fsrs_rating=1 if index < wrong else 3,
            self_rating=1 if index < wrong else 3,
        )
        for index in range(count)
    ]
    assert adaptive_new_limit(events, "2026-10-30")[0] == limit


def test_same_day_first_answer_wins():
    events = [
        _event(1, card_id=7, fsrs_rating=1, occurred_at=datetime(2026, 10, 30, 1, 0, tzinfo=timezone.utc)),
        _event(2, card_id=7, fsrs_rating=3, occurred_at=datetime(2026, 10, 30, 2, 0, tzinfo=timezone.utc)),
    ]
    limit, error, count = adaptive_new_limit(events, "2026-10-30")
    assert (limit, error, count) == (5, 1.0, 1)


def test_legacy_assisted_and_choice_do_not_enter_sample():
    events = [
        _event(1, source="legacy", fsrs_rating=1),
        _event(2, kind="typed", assistance=["first_letter"], fsrs_rating=1),
        _event(3, kind="choice", fsrs_rating=1),
        _event(4, fsrs_rating=3),
    ]
    assert adaptive_new_limit(events, "2026-10-30")[2] == 1


def test_metric_categories_separate_counts():
    events = [
        _event(1, kind="typed", correct=True, fsrs_rating=3),
        _event(2, kind="typed", correct=False, fsrs_rating=1),
        _event(3, kind="typed", assistance=["length"], correct=True, fsrs_rating=None),
        _event(4, kind="choice", correct=False, fsrs_rating=None),
        _event(5, kind="self_rating", correct=None, self_rating=4),
        _event(6, kind="self_rating", correct=None, self_rating=2),
        _event(7, kind="typed", correct=None, skipped=True),
        _event(8, kind="typed", correct=True, source="legacy"),
    ]
    assert metric(events, "retrieval") == {"successes": 1, "count": 2, "percent": 50}
    assert metric(events, "assisted") == {"successes": 1, "count": 1, "percent": 100}
    assert metric(events, "recognition") == {"successes": 0, "count": 1, "percent": 0}
    assert metric(events, "self_report") == {"successes": 1, "count": 2, "percent": 50}
    assert metric([], "retrieval")["percent"] is None


def test_review_pass_rate_uses_scheduled_events():
    events = [
        _event(1, fsrs_rating=4),
        _event(2, fsrs_rating=1),
        _event(3, kind="choice", scheduled=False, fsrs_rating=None),
    ]
    assert review_pass_rate(events) == {"successes": 1, "count": 2, "percent": 50}


def _review(ec, card_id, rating, source="study"):
    return ec.client.post(
        "/api/reviews",
        json={
            "card_id": card_id,
            "rating": rating,
            "source": source,
            "kind": "self_rating",
            "submission_id": str(uuid4()),
        },
    )


def test_sparse_success_does_not_raise_limit(ec):
    ec.set_time("2026-10-30T01:00:00+00:00")
    card_id = ec.seed_card()
    assert _review(ec, card_id, 3).status_code == 200
    today = ec.client.get("/api/today").json()
    assert today["recommended_goal"] == 10
    assert today["sample_count"] == 1


def test_high_error_rate_lowers_limit(ec):
    ec.set_time("2026-10-30T01:00:00+00:00")
    for index in range(7):
        card_id = ec.seed_card(f"word{index}")
        assert _review(ec, card_id, 1 if index < 3 else 3).status_code == 200
    today = ec.client.get("/api/today").json()
    assert today["recommended_goal"] == 5
    assert today["sample_count"] == 7


def test_stats_metrics_and_weekly_alias(ec):
    ec.set_time("2026-10-30T01:00:00+00:00")
    card_id = ec.seed_card()
    assert _review(ec, card_id, 4).status_code == 200
    typed = ec.client.post(
        "/api/typing/check",
        json={
            "card_id": card_id,
            "user_input": "apple",
            "source": "spelling",
            "kind": "typed",
            "submission_id": str(uuid4()),
        },
    )
    assert typed.status_code == 200, typed.text

    stats = ec.client.get("/api/stats").json()
    assert stats["metrics"]["self_report"] == {
        "successes": 1,
        "count": 1,
        "percent": 100,
    }
    assert stats["metrics"]["retrieval"]["count"] == 1
    assert stats["review_pass_rate"]["count"] >= 1

    weekly = ec.client.get("/api/stats/weekly").json()
    assert weekly["accuracy_kind"] == "review_pass_rate"
    assert weekly["this_week"] == 100
