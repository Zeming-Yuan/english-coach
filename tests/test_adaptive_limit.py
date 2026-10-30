"""难度自适应：近 7 个学习日的合格首答决定新词建议。"""

from uuid import uuid4


def _review(ec, card_id, rating):
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


def _seed_events(ec, wrong, right):
    for index in range(wrong + right):
        card_id = ec.seed_card(f"sample{index}")
        assert _review(ec, card_id, 1 if index < wrong else 3).status_code == 200


def test_no_data_default(ec):
    ec.seed_card("apple")
    response = ec.client.get("/api/today").json()
    assert response["recommended_goal"] == 10
    assert response["sample_count"] == 0


def test_high_error_rate_limits_to_5(ec):
    ec.set_time("2026-10-30T01:00:00+00:00")
    _seed_events(ec, wrong=4, right=6)  # 40% 错
    assert ec.client.get("/api/today").json()["recommended_goal"] == 5


def test_low_error_rate_raises_to_15(ec):
    ec.set_time("2026-10-30T01:00:00+00:00")
    _seed_events(ec, wrong=2, right=18)  # 10% 错，20 个有效样本
    assert ec.client.get("/api/today").json()["recommended_goal"] == 15


def test_mid_error_rate_keeps_default(ec):
    ec.set_time("2026-10-30T01:00:00+00:00")
    _seed_events(ec, wrong=2, right=8)  # 20% 错
    assert ec.client.get("/api/today").json()["recommended_goal"] == 10
