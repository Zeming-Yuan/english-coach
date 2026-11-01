"""EL-05：闪卡与专项练习准确记录答案接触和提示。

测试 seam：真实 FastAPI → Alembic 迁移建立的隔离 SQLite。
练习入口的公开载荷必须携带修订，答案展示/播放走统一接触接口。
"""

from uuid import uuid4

import pytest

from app.services.contacts import merge_assistance

PRACTICE_SOURCES = (
    "study",
    "spelling",
    "quiz",
    "listening",
    "mixed",
    "reinforcement",
)


def _revision(ec, card_id):
    return ec.client.get(f"/api/cards/{card_id}").json()["content_revision"]


def _contact(ec, card_id, revision, *, source, kind="answer_visible", submission_id=None):
    return ec.client.post(
        "/api/learning/contacts",
        json={
            "submission_id": submission_id or str(uuid4()),
            "card_id": card_id,
            "revision": revision,
            "source": source,
            "kind": kind,
        },
    )


def _contacts(ec):
    return ec.client.get("/api/export/backup").json()["extensions"][
        "learning_contacts"
    ]


@pytest.mark.parametrize(
    "arguments, expected",
    [
        ([[], []], []),
        ([[], ["first_letter"]], ["first_letter"]),
        ([["first_letter"], []], ["first_letter"]),
        ([["length"], ["length"]], ["length"]),
        (
            [["answer_visible"], ["answer_audio"]],
            ["answer_audio", "answer_visible"],
        ),
        (
            [["first_letter", "length"], ["live_feedback"]],
            ["first_letter", "length", "live_feedback"],
        ),
    ],
)
def test_el05_review_focus(arguments, expected):
    assert merge_assistance(*arguments) == expected


def test_el05_merge_assistance_rejects_unknown_kind():
    with pytest.raises(ValueError, match="unknown assistance"):
        merge_assistance([], ["telepathy"])


def test_el05_practice_payloads_carry_revision(ec):
    ids = [
        ec.seed_card(word=word, meaning=word)
        for word in ["apple", "book", "cat", "dog", "egg"]
    ]
    today = ec.client.get("/api/today").json()
    rows = [
        *today["queue"],
        *today["new_cards"],
        *today["due_cards"],
        *today["error_cards"],
    ]
    assert rows
    assert all(row["content_revision"]["version"] == 1 for row in rows)

    questions = ec.client.get("/api/quiz?limit=5").json()["questions"]
    assert questions
    assert all(question["content_revision"]["identity"] for question in questions)

    listening = ec.client.get("/api/listening?limit=5").json()["questions"]
    assert listening
    assert all(question["content_revision"]["version"] == 1 for question in listening)

    session_id = str(uuid4())
    assert (
        ec.client.post(
            "/api/reviews",
            json={
                "card_id": ids[0],
                "rating": 1,
                "source": "study",
                "kind": "self_rating",
                "session_id": session_id,
                "stage": "main",
            },
        ).status_code
        == 200
    )
    reinforcement = ec.client.get(
        f"/api/sessions/{session_id}/reinforcement"
    ).json()["questions"]
    assert reinforcement
    assert reinforcement[0]["content_revision"]["identity"]


@pytest.mark.parametrize("source", PRACTICE_SOURCES)
def test_el05_practice_sources_record_contact(ec, source):
    card_id = ec.seed_card()
    response = _contact(ec, card_id, _revision(ec, card_id), source=source)
    assert response.status_code == 200, response.text
    assert _contacts(ec)[-1]["source"] == source
    assert ec.client.get(f"/api/cards/{card_id}").json()["learning_events"] == []


def test_el05_practice_reads_do_not_fake_contact(ec):
    ec.seed_card(word="apple", meaning="苹果")
    ec.seed_card(word="book", meaning="书")
    ec.seed_card(word="cat", meaning="猫")
    ec.seed_card(word="dog", meaning="狗")
    before = ec.snapshot()
    assert ec.client.get("/api/today").status_code == 200
    assert ec.client.get("/api/quiz?limit=5").status_code == 200
    assert ec.client.get("/api/listening?limit=5").status_code == 200
    assert ec.snapshot() == before


def test_el05_contact_and_attempt_identities_are_separate(ec):
    card_id = ec.seed_card()
    submission_id = str(uuid4())
    contact = _contact(
        ec, card_id, _revision(ec, card_id), source="spelling", submission_id=submission_id
    )
    assert contact.status_code == 200, contact.text
    attempt = ec.client.post(
        "/api/typing/check",
        json={
            "card_id": card_id,
            "user_input": "apple",
            "source": "spelling",
            "submission_id": submission_id,
            "assistance": ["answer_visible"],
        },
    )
    assert attempt.status_code == 200, attempt.text
    assert len(_contacts(ec)) == 1
    detail = ec.client.get(f"/api/cards/{card_id}").json()
    assert len(detail["learning_events"]) == 1
    assert detail["learning_events"][0]["assistance"] == ["answer_visible"]


def test_el05_practice_contact_roundtrips_through_v3(ec, ec_factory):
    card_id = ec.seed_card()
    assert (
        _contact(ec, card_id, _revision(ec, card_id), source="study").status_code
        == 200
    )
    backup = ec.client.get("/api/export/backup").json()
    target = ec_factory()
    preview = target.client.post("/api/import/preview", json=backup)
    assert preview.status_code == 200, preview.text
    assert (
        target.client.post(
            "/api/import/cards",
            json={
                "backup": backup,
                "expected_revision": preview.json()["expected_revision"],
            },
        ).status_code
        == 200
    )
    rows = _contacts(target)
    assert len(rows) == 1
    assert rows[0]["source"] == "study"
    restored = next(
        row for row in target.client.get("/api/export/backup").json()["cards"]
        if row["word"] == "apple"
    )
    detail = target.client.get(f"/api/cards/{restored['id']}").json()
    assert detail["last_contact"]["source"] == "study"
    assert detail["contact_integrity"]["status"] == "confirmed"


def test_el05_commit_failure_and_retry_keeps_assistance(ec):
    card_id = ec.seed_card()
    payload = {
        "card_id": card_id,
        "user_input": "apple",
        "source": "spelling",
        "submission_id": str(uuid4()),
        "assistance": ["answer_visible"],
    }
    before = ec.snapshot()
    ec.fail_commit_once()
    failed = ec.client.post("/api/typing/check", json=payload)
    assert failed.status_code == 500
    assert ec.snapshot() == before

    saved = ec.client.post("/api/typing/check", json=payload)
    assert saved.status_code == 200
    after = ec.snapshot()
    replay = ec.client.post("/api/typing/check", json=payload)
    assert replay.status_code == 200
    assert ec.snapshot() == after
    events = ec.client.get(f"/api/cards/{card_id}").json()["learning_events"]
    assert len(events) == 1
    assert events[0]["assistance"] == ["answer_visible"]
