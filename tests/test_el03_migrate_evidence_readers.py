"""EL-03：首页、词表、统计和分享图统一解释学习进展。"""

from uuid import uuid4

import pytest

from app.services.learning_evidence import evidence_label


def _typing(ec, card_id, answer="apple"):
    return ec.client.post(
        "/api/typing/check",
        json={
            "card_id": card_id,
            "user_input": answer,
            "source": "spelling",
            "submission_id": str(uuid4()),
            "assistance": [],
        },
    )


def _two_days(ec, card_id):
    for now in ("2026-10-01T01:00:00Z", "2026-10-02T01:00:00Z"):
        ec.set_time(now)
        assert _typing(ec, card_id).status_code == 200


def _list_row(ec, card_id):
    return next(
        card
        for card in ec.client.get("/api/cards").json()["cards"]
        if card["id"] == card_id
    )


def test_el03_list_explains_unlock_instead_of_mastery(ec):
    card_id = ec.seed_card()
    cards = ec.client.get("/api/cards").json()["cards"]
    row = next(card for card in cards if card["id"] == card_id)
    assert row["learning_evidence"]["recall"]["status"] == "insufficient"
    assert row["progress_label"] == "独立证据不足"
    today = ec.client.get("/api/today").json()
    queued = next(card for card in today["queue"] if card["id"] == card_id)
    assert queued["progress_label"] == "独立证据不足"


@pytest.mark.parametrize(
    "arguments, expected",
    [
        (["verified"], "独立回忆已有证据"),
        (["weak"], "仍需巩固"),
        (["stale"], "历史证据，待复测"),
        (["history_incomplete"], "历史依据不完整"),
        (["insufficient"], "独立证据不足"),
        (["unrecognized"], "独立证据不足"),
    ],
)
def test_el03_evidence_label_matrix(arguments, expected):
    assert evidence_label(*arguments) == expected


def test_el03_all_readers_share_verified_evidence(ec):
    card_id = ec.seed_card()
    _two_days(ec, card_id)
    row = _list_row(ec, card_id)
    assert row["progress_label"] == "独立回忆已有证据"

    today = ec.client.get("/api/today").json()
    assert today["evidence_counts"]["verified"] == 1
    assert today["evidence_samples"] == 2

    stats = ec.client.get("/api/stats").json()
    assert stats["evidence_counts"]["verified"] == 1
    assert stats["evidence_samples"] == 2
    assert stats["evidence_latest_at"].startswith("2026-10-02")


def test_el03_all_readers_share_weak_label(ec):
    card_id = ec.seed_card()
    _two_days(ec, card_id)
    ec.set_time("2026-10-03T01:00:00Z")
    assert _typing(ec, card_id, answer="wrong").status_code == 200
    assert _list_row(ec, card_id)["progress_label"] == "仍需巩固"
    assert ec.client.get("/api/today").json()["evidence_counts"]["weak"] == 1
    assert ec.client.get("/api/stats").json()["evidence_counts"]["weak"] == 1


def test_el03_stale_evidence_never_looks_current(ec):
    card_id = ec.seed_card()
    _two_days(ec, card_id)
    ec.set_time("2026-11-15T01:00:00Z")
    assert _list_row(ec, card_id)["progress_label"] == "历史证据，待复测"
    stats = ec.client.get("/api/stats").json()
    assert stats["evidence_counts"]["stale"] == 1
    assert stats["evidence_latest_at"].startswith("2026-10-02")


def test_el03_edit_and_old_events_stay_conservative(ec):
    card_id = ec.seed_card(meaning="苹果")
    _two_days(ec, card_id)
    assert _list_row(ec, card_id)["progress_label"] == "独立回忆已有证据"
    assert (
        ec.client.put(f"/api/cards/{card_id}", json={"meaning": "一个苹果"}).status_code
        == 200
    )
    row = _list_row(ec, card_id)
    assert row["progress_label"] == "独立证据不足"
    assert row["learning_evidence"]["revision"]["version"] == 2

    # 旧修订事件仍然以历史不完整之外的明确标签呈现。
    from app.models.review_event import ReviewEvent

    db = ec.SessionLocal()
    try:
        db.query(ReviewEvent).filter(ReviewEvent.card_id == card_id).update(
            {"card_identity": None, "card_revision": None}
        )
        db.commit()
    finally:
        db.close()
    assert _list_row(ec, card_id)["progress_label"] == "历史依据不完整"


def test_el03_reading_is_not_learning(ec):
    ec.seed_card()
    before = ec.snapshot()
    first = ec.client.get("/api/cards")
    second = ec.client.get("/api/cards")
    assert first.status_code == second.status_code == 200
    assert ec.snapshot() == before


def test_el03_sentence_cards_do_not_skew_word_counts(ec):
    ec.seed_card(word="apple", kind="word")
    ec.seed_card(word="apple", kind="sentence")
    rows = ec.client.get("/api/cards").json()["cards"]
    assert len(rows) == 2
    assert all("progress_label" in row for row in rows)
    stats = ec.client.get("/api/stats").json()
    assert stats["evidence_counts"]["insufficient"] == 1
