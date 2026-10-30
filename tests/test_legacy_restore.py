"""EC-11：旧版备份严格校验与原子部分恢复。"""

import json

import pytest

from app.services import restore


def _legacy_payload() -> dict:
    return {
        "cards": [
            {"id": 1, "word": "apple", "kind": "word", "meaning": "苹果"},
            {"id": 2, "word": "apple", "kind": "sentence", "meaning": "苹果的句子"},
        ],
        "reviews": [
            {
                "card_id": 1,
                "state": 2,
                "due": "2026-10-30T00:00:00",
                "stability": 3.0,
                "difficulty": 5.0,
                "elapsed_days": 1,
                "last_review": "2026-10-29T00:00:00",
                "review_count": 2,
                "rating": 3,
            }
        ],
        "memos": [{"card_id": 2, "content": "句子记忆"}],
        "errors": [{"card_id": 1, "error_count": 2}],
    }


def test_malformed_legacy_does_not_erase_progress(ec):
    card_id = ec.seed_card()
    assert (
        ec.client.post("/api/reviews", json={"card_id": card_id, "rating": 3}).status_code
        == 200
    )
    assert (
        ec.client.put(f"/api/memos/{card_id}", json={"content": "记住苹果"}).status_code
        == 200
    )
    before = ec.snapshot()
    payload = {
        "cards": [{"id": card_id, "word": "apple", "kind": "word"}],
        "reviews": [{"card_id": card_id, "state": "not-an-int"}],
    }
    response = ec.client.post("/api/import/cards", json=payload)
    assert response.status_code == 422
    assert ec.snapshot() == before


@pytest.mark.parametrize(
    "review",
    [
        {"card_id": 1, "state": "broken"},
        {"card_id": 1, "state": 99},
        {"card_id": 1, "state": 1, "review_count": -1},
        {"card_id": 999, "state": 1},
    ],
)
def test_legacy_invalid_review_focus(ec, review):
    ec.seed_card()
    before = ec.snapshot()
    response = ec.client.post(
        "/api/import/cards",
        json={"cards": [{"id": 1, "word": "apple", "kind": "word"}], "reviews": [review]},
    )
    assert response.status_code == 422
    assert ec.snapshot() == before


def test_legacy_nan_stability_is_rejected(ec):
    ec.seed_card()
    before = ec.snapshot()
    body = (
        '{"cards":[{"id":1,"word":"apple","kind":"word"}],'
        '"reviews":[{"card_id":1,"state":1,"stability":NaN}]}'
    )
    response = ec.client.post(
        "/api/import/cards",
        content=body,
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 422
    assert ec.snapshot() == before


def test_same_word_two_kinds_restore_independently(ec):
    response = ec.client.post("/api/import/cards", json=_legacy_payload())
    assert response.status_code == 200, response.text
    cards = ec.client.get("/api/cards").json()["cards"]
    assert {(card["word"], card["kind"]) for card in cards} == {
        ("apple", "word"),
        ("apple", "sentence"),
    }
    word_card = next(card for card in cards if card["kind"] == "word")
    sentence_card = next(card for card in cards if card["kind"] == "sentence")
    assert word_card["review_count"] == 2
    word_detail = ec.client.get(f"/api/cards/{word_card['id']}").json()
    assert word_detail["learning_events"] == []
    assert word_detail["history_incomplete"] is True
    sentence_detail = ec.client.get(f"/api/cards/{sentence_card['id']}").json()
    assert sentence_detail["memo"] == "句子记忆"
    assert sentence_detail["learning_events"] == []
    assert sentence_detail["history_incomplete"] is False
    assert sentence_detail["memory_state"] is None


def test_ambiguous_target_is_rejected(ec):
    ec.seed_card("apple", kind="word")
    ec.seed_card("apple", kind="word")
    before = ec.snapshot()
    response = ec.client.post(
        "/api/import/cards",
        json={"cards": [{"id": 1, "word": "apple", "kind": "word"}]},
    )
    assert response.status_code == 422
    assert "多张" in str(response.json()["detail"])
    assert ec.snapshot() == before


def test_safety_backup_failure_keeps_data(ec, monkeypatch):
    ec.seed_card()
    before = ec.snapshot()

    def fail(*_args, **_kwargs):
        raise OSError("disk full")

    monkeypatch.setattr(restore, "persist_safety_backup", fail)
    response = ec.client.post(
        "/api/import/cards",
        json={"cards": [{"id": 1, "word": "banana", "kind": "word"}]},
    )
    assert response.status_code == 500
    assert ec.snapshot() == before


def test_failed_commit_keeps_data(ec):
    ec.seed_card()
    before = ec.snapshot()
    ec.fail_commit_once()
    response = ec.client.post(
        "/api/import/cards",
        json={"cards": [{"id": 1, "word": "banana", "kind": "word"}]},
    )
    assert response.status_code == 500
    assert ec.snapshot() == before


def test_preview_revision_conflict(ec):
    ec.seed_card()
    preview = ec.client.post("/api/import/preview", json=_legacy_payload()).json()
    assert preview["mode"] == "legacy_partial"
    assert preview["expected_revision"]

    card_id = ec.seed_card("new-word")
    assert (
        ec.client.post("/api/reviews", json={"card_id": card_id, "rating": 3}).status_code
        == 200
    )
    response = ec.client.post(
        "/api/import/cards",
        json={"backup": _legacy_payload(), "expected_revision": preview["expected_revision"]},
    )
    assert response.status_code == 409


def test_repeat_import_is_idempotent(ec):
    first = ec.client.post("/api/import/cards", json=_legacy_payload())
    assert first.status_code == 200
    before = ec.snapshot()
    second = ec.client.post("/api/import/cards", json=_legacy_payload())
    assert second.status_code == 200
    assert second.json()["imported_words"] == 0
    assert ec.snapshot() == before


def test_preview_does_not_write(ec):
    before = ec.snapshot()
    preview = ec.client.post("/api/import/preview", json=_legacy_payload())
    assert preview.status_code == 200
    assert ec.snapshot() == before
    assert json.dumps(preview.json())
