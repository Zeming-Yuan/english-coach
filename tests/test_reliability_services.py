"""Public service regressions from the reliability audit."""

from datetime import UTC, datetime

import pytest

from app.services.scoring import make_fill_prompt


def test_cloze_matches_a_word_instead_of_a_substring():
    assert (
        make_fill_prompt("Concatenate the cat pictures.", "cat")
        == "Concatenate the ___ pictures."
    )


def test_starter_batch_reuses_duplicates_and_owns_card_kind(db_session):
    from app.services.starter_cards import load_starter_cards

    row = {
        "word": "hello",
        "meaning": "你好",
        "kind": "sentence",
        "difficulty": "reading",
    }
    added = load_starter_cards(db_session, [row, row])
    assert [(card.word, card.kind, card.difficulty) for card in added] == [
        ("hello", "word", "basic")
    ]


def test_weighted_error_records_latest_failure_time(db_session):
    from app.models.error_card import ErrorCard
    from app.services.error_tracking import record_error

    row = ErrorCard(card_id=1, error_count=1, last_error_at=datetime(2000, 1, 1))
    db_session.add(row)
    db_session.commit()
    assert record_error(db_session, 1, False) == 2
    assert row.last_error_at > datetime(2000, 1, 1)


def test_non_ascii_question_signature_is_invalid_input():
    from app.models.card import Card
    from app.services.questions import (
        InvalidQuestionToken,
        issue_question,
        verify_question,
    )

    secret = b"test-secret"
    question = issue_question(Card(id=1, word="cat"), "choice", ["cat"], "cat", secret)
    token = question["token"].rsplit(".", 1)[0] + ".签名"
    with pytest.raises(InvalidQuestionToken):
        verify_question(token, secret, datetime.now(UTC))


def test_deep_question_json_is_invalid_input():
    import base64

    from app.services.questions import InvalidQuestionToken, verify_question

    raw = ("[" * 20000 + "0" + "]" * 20000).encode()
    token = base64.urlsafe_b64encode(raw).decode() + ".signature"
    with pytest.raises(InvalidQuestionToken):
        verify_question(token, b"test", datetime.now(UTC))


def test_generator_keeps_only_one_card_per_requested_word(db_session, monkeypatch):
    from app.services import card_generator

    monkeypatch.setattr(
        card_generator,
        "generate_json",
        lambda *args: {"cards": [{"word": "cat"}, {"word": "cat"}]},
    )
    cards = card_generator.generate_cards(["cat", "cat"], db_session)
    assert [card.word for card in cards] == ["cat"]


def test_generator_discards_chunks_of_a_rejected_example(db_session, monkeypatch):
    from app.services import card_generator

    monkeypatch.setattr(
        card_generator,
        "generate_json",
        lambda *args: {
            "cards": [
                {
                    "word": "cat",
                    "example": "This is a cat.",
                    "chunks": ["This is", "a cat"],
                }
            ]
        },
    )
    card = card_generator.generate_cards(["cat"], db_session)[0]
    assert card.example == ""
    assert card.chunks is None


def test_lesson_rejects_nontext_phonetic():
    from app.services.lesson_generator import validate_lesson

    payload = {
        "title": "Hello",
        "words": [
            {
                "word": "hello",
                "meaning": "你好",
                "phonetic": ["bad"],
                "example": "Hello there.",
                "example_cn": "你好。",
            }
        ],
        "dialogue": [{"speaker": "A", "en": "Hello", "cn": "你好"}],
    }
    with pytest.raises(ValueError, match="音标"):
        validate_lesson(payload)


def test_lesson_reuses_existing_word_regardless_of_case(db_session, monkeypatch):
    from sqlalchemy import select

    from app.models.card import Card
    from app.runtime import Runtime, SystemClock
    from app.services import lesson_generator

    db_session.add(Card(word="hello", meaning="你好", kind="word"))
    db_session.commit()
    payload = {
        "title": "Hello",
        "words": [
            {
                "word": "Hello",
                "meaning": "你好",
                "example": "Hello there.",
                "example_cn": "你好。",
            }
        ],
        "dialogue": [{"speaker": "A", "en": "Hello", "cn": "你好"}],
    }
    monkeypatch.setattr(lesson_generator, "generate_json", lambda *args: payload)
    lesson_generator.generate_lesson(db_session, 1, runtime=Runtime(SystemClock()))
    assert list(db_session.scalars(select(Card.word))) == ["hello"]


def test_revision_reads_refresh_a_previously_loaded_row(db_session):
    from sqlalchemy.orm import Session

    from app.models.card import Card
    from app.services.content_revisions import (
        advance_content_revision,
        get_content_revision,
    )

    card = Card(word="cat", meaning="猫", kind="word")
    db_session.add(card)
    db_session.commit()
    # Keep the row alive in this Session's identity map.
    from app.models.content_revision import ContentRevision

    row = db_session.query(ContentRevision).one()
    assert get_content_revision(db_session, "card", card.id)["version"] == 1
    with Session(db_session.get_bind()) as other:
        advance_content_revision(other, "card", card.id, {"meaning": "小猫"})
        other.commit()
    assert get_content_revision(db_session, "card", card.id)["version"] == 2
    assert row.version == 2


def test_overlapping_revision_writes_keep_both_increments(db_session):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event, current_thread

    from sqlalchemy import event
    from sqlalchemy.orm import Session

    from app.models.card import Card
    from app.services.content_revisions import (
        advance_content_revision,
        get_content_revision,
    )

    card = Card(word="cat", meaning="猫", kind="word")
    db_session.add(card)
    db_session.commit()
    card_id = card.id
    ready, release = Event(), Event()
    engine = db_session.get_bind()

    def pause_first(connection, cursor, statement, parameters, context, executemany):
        if statement.startswith(
            "UPDATE content_revisions"
        ) and current_thread().name.startswith("revision"):
            ready.set()
            assert release.wait(5)

    def first():
        with Session(engine) as session:
            advance_content_revision(session, "card", card_id, {"meaning": "小猫"})
            session.commit()

    event.listen(engine, "before_cursor_execute", pause_first)
    try:
        with ThreadPoolExecutor(max_workers=1, thread_name_prefix="revision") as pool:
            future = pool.submit(first)
            try:
                assert ready.wait(5)
                with Session(engine) as second:
                    advance_content_revision(
                        second, "card", card_id, {"meaning": "家猫"}
                    )
                    second.commit()
            finally:
                release.set()
            future.result(timeout=5)
    finally:
        event.remove(engine, "before_cursor_execute", pause_first)
    assert get_content_revision(db_session, "card", card_id)["version"] == 3


def test_ai_sentence_null_translation_preserves_saved_translation(
    db_session, monkeypatch
):
    from sqlalchemy.orm import sessionmaker

    from app import db as db_module
    from app.models.card import Card
    from app.services import graduation

    card = Card(
        word="cat",
        meaning="猫",
        example="A cat sleeps.",
        example_cn="猫在睡觉。",
        kind="word",
    )
    db_session.add(card)
    db_session.commit()
    sentence = graduation.ensure_sentence_card(card, db_session)
    assert sentence is not None
    db_session.commit()
    monkeypatch.setattr(
        db_module, "SessionLocal", sessionmaker(bind=db_session.get_bind())
    )
    monkeypatch.setattr(
        graduation,
        "generate_json",
        lambda *args: {"example": "The cat sleeps by the window.", "example_cn": None},
    )
    graduation.upgrade_sentence_card(card.id)
    db_session.refresh(sentence)
    assert (sentence.example_cn, sentence.meaning) == ("猫在睡觉。", "猫在睡觉。")
    assert sentence.example == "The cat sleeps by the window."


def test_write_transaction_preserves_business_error_when_rollback_fails():
    from unittest.mock import Mock

    from app.services.write_transaction import run_write

    db = Mock()
    db.in_transaction.return_value = False
    db.rollback.side_effect = OSError("rollback failed")
    error = ValueError("business error")

    def operation(session):
        raise error

    with pytest.raises(ValueError, match="business error") as caught:
        run_write(db, operation)
    assert caught.value is error


def test_write_transaction_reports_connection_failure_without_disguising_it():
    from unittest.mock import Mock

    from app.services.write_transaction import run_write

    db = Mock()
    db.in_transaction.return_value = True
    db.connection.side_effect = OSError("connection unavailable")
    with pytest.raises(OSError, match="connection unavailable"):
        run_write(db, lambda session: None)


def test_adaptive_limit_uses_saved_order_for_identical_timestamps():
    from app.services.statistics import adaptive_new_limit

    base = {
        "occurred_at": "2026-11-05T00:00:00Z",
        "learning_day": "2026-11-05",
        "scheduled": True,
        "source": "spelling",
        "kind": "typed",
        "assistance": [],
    }
    events = [
        {**base, "card_id": 1, "event_id": "z", "saved_order": 1, "fsrs_rating": 1},
        {**base, "card_id": 1, "event_id": "a", "saved_order": 2, "fsrs_rating": 3},
    ]
    assert adaptive_new_limit(events, "2026-11-05") == (5, 1.0, 1)


def test_lesson_replay_rejects_changing_weak_only(ec):
    from tests.test_el08_lesson_recall_check import _create, _seed_lesson

    lesson_id, _ = _seed_lesson(ec, ["apple"])
    first = _create(ec, lesson_id)
    assert first.status_code == 200
    replay = _create(ec, lesson_id, weak_only=True, session_id=first.json()["id"])
    assert replay.status_code == 409


def test_delayed_replay_cannot_omit_frozen_targets(ec):
    from tests.test_el09_delayed_recall_check import _basis, _create

    card_id = _basis(ec)
    ec.set_time("2026-10-08T01:00:00Z")
    revision = ec.client.get(f"/api/cards/{card_id}").json()["content_revision"]
    first = _create(
        ec, card_ids=[card_id], targets=[{"card_id": card_id, "revision": revision}]
    )
    assert first.status_code == 200, first.text
    replay = _create(ec, id=first.json()["id"], targets=[])
    assert replay.status_code == 409


def test_scene_feedback_with_empty_templates_reports_unavailable(ec, monkeypatch):
    import json
    from pathlib import Path

    from tests.test_el16_bounded_ai_scene_feedback import (
        request_feedback,
        saved_scene_item,
    )

    run, item_id = saved_scene_item(ec)
    read_text = Path.read_text

    def empty_template(path, *args, **kwargs):
        raw = read_text(path, *args, **kwargs)
        if path.parent.name == "scene_feedback":
            material = json.loads(raw)
            for scene in material["accepted"].values():
                for key in scene:
                    scene[key] = []
            return json.dumps(material)
        return raw

    monkeypatch.setattr(Path, "read_text", empty_template)
    response = request_feedback(ec, run, item_id)
    assert response.status_code == 422, response.text


def test_practice_replay_flags_survive_v3_restore(ec, ec_factory):
    from tests.test_el08_lesson_recall_check import _create, _seed_lesson
    from tests.test_el18_personal_active_time_estimate import restore

    lesson_id, _ = _seed_lesson(ec, ["apple"])
    first = _create(ec, lesson_id, weak_only=True).json()
    backup = ec.client.get("/api/export/backup").json()
    assert backup["extensions"]["practice_sessions"][0]["weak_only"] is True
    other = ec_factory()
    restore(other, backup)
    restored_lesson = other.snapshot()["lessons"][0]["id"]
    assert (
        _create(
            other, restored_lesson, weak_only=True, session_id=first["id"]
        ).status_code
        == 200
    )
    assert (
        _create(
            other, restored_lesson, weak_only=False, session_id=first["id"]
        ).status_code
        == 409
    )


def test_older_v3_without_replay_flags_remains_restorable(ec, ec_factory):
    from tests.test_el08_lesson_recall_check import _create, _seed_lesson
    from tests.test_el18_personal_active_time_estimate import restore

    lesson_id, _ = _seed_lesson(ec, ["apple"])
    _create(ec, lesson_id)
    backup = ec.client.get("/api/export/backup").json()
    for row in backup["extensions"]["practice_sessions"]:
        row.pop("weak_only")
        row.pop("targets_explicit")
    other = ec_factory()
    restore(other, backup)
    saved = other.snapshot()["extensions"]["practice_sessions"][0]
    assert saved["weak_only"] is False
    assert saved["targets_explicit"] is False


def test_previous_schema_upgrades_existing_practice_rows(tmp_path):
    from sqlalchemy import create_engine, text

    from alembic import command
    from tests.test_installation import _migration_config

    url = f"sqlite:///{tmp_path / 'upgrade.db'}"
    config = _migration_config(url)
    command.upgrade(config, "el18_practice_durations")
    engine = create_engine(url)
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO practice_sessions (session_id, purpose, status, rule_version, created_at) VALUES ('old', 'lesson_check', 'unavailable', 'el08-v1', '2026-11-05')"
                )
            )
        command.upgrade(config, "head")
        with engine.connect() as connection:
            assert tuple(
                connection.execute(
                    text(
                        "SELECT session_id, weak_only, targets_explicit FROM practice_sessions"
                    )
                ).one()
            ) == ("old", 0, 0)
    finally:
        engine.dispose()


def test_lesson_word_cards_find_reused_card_with_different_case(db_session):
    from app.models.card import Card
    from app.models.lesson import Lesson
    from app.services.content_revisions import lesson_word_cards

    card = Card(word="hello", meaning="你好", kind="word")
    db_session.add(card)
    db_session.commit()
    lesson = Lesson(level=1, title="Hello", content={"words": [{"word": "Hello"}]})
    assert [entry["id"] for entry in lesson_word_cards(db_session, lesson)] == [card.id]


def test_delayed_target_constraint_survives_restore(ec, ec_factory):
    from tests.test_el09_delayed_recall_check import _basis, _create
    from tests.test_el18_personal_active_time_estimate import restore

    card_id = _basis(ec)
    ec.set_time("2026-10-08T01:00:00Z")
    revision = ec.client.get(f"/api/cards/{card_id}").json()["content_revision"]
    first = _create(
        ec, card_ids=[card_id], targets=[{"card_id": card_id, "revision": revision}]
    )
    assert first.status_code == 200
    other = ec_factory()
    restore(other, ec.client.get("/api/export/backup").json())
    assert _create(other, id=first.json()["id"], targets=[]).status_code == 409


def test_scene_catalogue_rejects_invalid_slot_structure(monkeypatch):
    import json
    from pathlib import Path

    from app.services.scenes import scene_rules

    read_text = Path.read_text

    def broken_slot(path, *args, **kwargs):
        raw = read_text(path, *args, **kwargs)
        if path.name == "introduction.json":
            material = json.loads(raw)
            for task in material["tasks"]:
                if "slot" in task:
                    task["slot"] = None
            return json.dumps(material)
        return raw

    monkeypatch.setattr(Path, "read_text", broken_slot)
    with pytest.raises(ValueError, match="场景材料"):
        scene_rules("introduction")


def test_budget_plan_rejects_nonpositive_estimate():
    from app.services.time_budget import budget_plan

    estimates = {
        kind: {"seconds": 20, "basis": "default", "sample_count": 0}
        for kind in ("review", "new", "reinforcement")
    }
    estimates["review"]["seconds"] = 0
    with pytest.raises(ValueError, match="estimate"):
        budget_plan([], [], 3, 1, estimates=estimates)


def test_scene_feedback_missing_saved_answer_reports_unavailable(ec):
    from sqlalchemy import delete

    from app.models.scene_attempt import SceneAttempt
    from tests.test_el16_bounded_ai_scene_feedback import (
        request_feedback,
        saved_scene_item,
    )

    run, item_id = saved_scene_item(ec)
    with ec.SessionLocal() as db:
        db.execute(delete(SceneAttempt))
        db.commit()
    response = request_feedback(ec, run, item_id)
    assert response.status_code == 422, response.text
