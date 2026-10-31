"""Saved daily-session contracts through migrated SQLite and public HTTP."""

from uuid import uuid4


def save(ec, session, card_id, **fields):
    payload = {
        "card_id": card_id,
        "rating": 1,
        "source": "study",
        "kind": "self_rating",
        "submission_id": str(uuid4()),
        "session_id": session,
        "stage": "main",
    }
    payload.update(fields)
    response = ec.client.post("/api/reviews", json=payload)
    assert response.status_code == 200, response.text
    return response.json()


def test_reinforcement_is_unique_and_bounded(ec):
    session = str(uuid4())
    ids = [ec.seed_card(word=word) for word in ["apple", "book", "cat", "dog"]]
    for card_id in [ids[0], *ids]:
        save(ec, session, card_id)
    response = ec.client.get(f"/api/sessions/{session}/reinforcement")
    assert response.status_code == 200
    assert [q["card_id"] for q in response.json()["questions"]] == ids[:3]


def test_reinforcement_does_not_refill_saved_slots_after_refresh(ec):
    session = str(uuid4())
    ids = [ec.seed_card(word=f"word{i}") for i in range(5)]
    for card_id in ids:
        save(ec, session, card_id)
    for card_id in ids[:3]:
        save(
            ec,
            session,
            card_id,
            rating=None,
            kind="typed",
            answer="wrong",
            source="reinforcement",
            stage="reinforcement",
        )
    ec.restart()
    assert (
        ec.client.get(f"/api/sessions/{session}/reinforcement").json()["questions"]
        == []
    )


def test_summary_counts_saved_events_and_only_independent_success_clears_weakness(ec):
    session = str(uuid4())
    apple = ec.seed_card(word="apple")
    book = ec.seed_card(word="book")
    save(ec, session, apple)
    save(ec, session, book, rating=2)
    save(
        ec,
        session,
        apple,
        rating=None,
        kind="typed",
        answer="apple",
        assistance=["first_letter"],
        source="reinforcement",
        stage="reinforcement",
    )
    path = f"/api/sessions/{session}/summary"
    before = ec.snapshot()
    response = ec.client.get(path)
    assert response.status_code == 200
    data = response.json()
    assert data["counts"] == {
        "main": 2,
        "reinforcement": 1,
        "skipped": 0,
        "completed_cards": 2,
    }
    assert data["metrics"]["assisted"] == {"successes": 1, "count": 1, "percent": 100}
    assert data["metrics"]["retrieval"]["count"] == 0
    assert {w["card_id"] for w in data["weak_words"]} == {apple, book}
    assert data["next_due"] is not None
    assert ec.snapshot() == before
    save(
        ec,
        session,
        apple,
        rating=None,
        kind="typed",
        answer="apple",
        source="reinforcement",
        stage="reinforcement",
    )
    assert [w["card_id"] for w in ec.client.get(path).json()["weak_words"]] == [book]
    save(ec, session, book, rating=3, stage="reinforcement", source="reinforcement")
    assert ec.client.get(path).json()["weak_words"] == []


def test_unknown_and_no_weak_sessions_are_distinct(ec):
    for suffix in ["summary", "reinforcement"]:
        assert ec.client.get(f"/api/sessions/{uuid4()}/{suffix}").status_code == 404
    session = str(uuid4())
    save(ec, session, ec.seed_card(), rating=3)
    assert ec.client.get(f"/api/sessions/{session}/reinforcement").json() == {
        "questions": []
    }


def test_unusable_or_deleted_weak_cards_finish_normally(ec):
    session = str(uuid4())
    unusable = ec.seed_card(word="empty", meaning="")
    deleted = ec.seed_card(word="deleted")
    save(ec, session, unusable)
    save(ec, session, deleted)
    assert ec.client.delete(f"/api/cards/{deleted}").status_code == 200
    assert ec.client.get(f"/api/sessions/{session}/reinforcement").json() == {
        "questions": []
    }


def test_main_skip_has_no_rating_schedule_or_error_and_roundtrips(ec, ec_factory):
    session = str(uuid4())
    cid = ec.seed_card()
    result = save(ec, session, cid, rating=None, skipped=True)
    assert result["correct"] is None and result["scheduled"] is False
    backup = ec.client.get("/api/export/backup").json()
    assert backup["reviews"] == backup["errors"] == []
    assert backup["learning_events"][0]["self_rating"] is None
    assert ec.client.get(f"/api/sessions/{session}/summary").json()["counts"] == {
        "main": 1,
        "reinforcement": 0,
        "completed_cards": 0,
        "skipped": 1,
    }
    assert (
        len(ec.client.get(f"/api/sessions/{session}/reinforcement").json()["questions"])
        == 1
    )
    target = ec_factory()
    preview = target.client.post("/api/import/preview", json={"backup": backup})
    assert preview.status_code == 200, preview.text
    restored = target.client.post(
        "/api/import/cards",
        json={
            "backup": backup,
            "expected_revision": preview.json()["expected_revision"],
        },
    )
    assert restored.status_code == 200, restored.text
    assert (
        target.client.get(f"/api/sessions/{session}/summary").json()["counts"][
            "skipped"
        ]
        == 1
    )
    assert (
        ec.client.post(
            "/api/reviews",
            json={"card_id": cid, "source": "study", "kind": "self_rating"},
        ).status_code
        == 422
    )
