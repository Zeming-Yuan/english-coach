"""EC-12 full replacement through real migrated application HTTP."""

import copy
from uuid import uuid4

import pytest


def test_restore_preserves_two_kinds_and_replay(ec, ec_factory):
    cid = ec.seed_card(word="apple", kind="word", id=101)
    ec.seed_card(word="apple", kind="sentence", id=202)
    sid = str(uuid4())
    request = {
        "card_id": cid,
        "rating": 3,
        "source": "study",
        "kind": "self_rating",
        "submission_id": sid,
    }
    assert ec.client.post("/api/reviews", json=request).status_code == 200
    backup = ec.client.get("/api/export/backup").json()
    other = ec_factory()
    other.seed_card("replace-me", id=900)
    preview = other.client.post("/api/import/preview", json=backup)
    assert preview.status_code == 200, preview.text
    assert preview.json()["mode"] == "full_replace"
    result = other.client.post(
        "/api/import/cards",
        json={
            "backup": backup,
            "expected_revision": preview.json()["expected_revision"],
        },
    )
    assert result.status_code == 200, result.text
    cards = other.client.get("/api/cards").json()["cards"]
    assert sorted(c["kind"] for c in cards) == ["sentence", "word"]
    mapped = next(c["id"] for c in cards if c["kind"] == "word")
    assert mapped != cid
    replay = other.client.post("/api/reviews", json={**request, "card_id": mapped})
    assert replay.status_code == 200, replay.text
    assert replay.json()["card_id"] == mapped
    assert len(other.client.get(f"/api/cards/{mapped}").json()["learning_events"]) == 1
    assert (
        other.client.post(
            "/api/reviews",
            json={**request, "card_id": mapped, "submission_id": str(uuid4())},
        ).status_code
        == 200
    )
    assert len(other.client.get(f"/api/cards/{mapped}").json()["learning_events"]) == 2


@pytest.mark.parametrize(
    "mutation",
    [
        "future",
        "duplicate",
        "dangling",
        "nan",
        "negative",
        "bad_id",
        "bad_date",
        "unknown",
        "missing",
        "timezone",
        "event_command",
        "event_cache",
        "event_uuid",
        "event_day",
        "nested_nan",
        "duplicate_submission",
    ],
)
def test_invalid_full_graph_rejected_before_any_write(ec, mutation):
    cid = ec.seed_card(id=41)
    assert (
        ec.client.post(
            "/api/reviews",
            json={
                "card_id": cid,
                "rating": 3,
                "source": "study",
                "submission_id": str(uuid4()),
            },
        ).status_code
        == 200
    )
    payload = ec.client.get("/api/export/backup").json()
    before = ec.snapshot()
    if mutation == "future":
        payload["version"] = 99
    elif mutation == "duplicate":
        payload["cards"].append(dict(payload["cards"][0]))
    elif mutation == "dangling":
        payload["story_words"] = [{"id": 1, "story_id": 999, "card_id": cid}]
    elif mutation == "nan":
        payload["reviews"][0]["stability"] = "NaN"
    elif mutation == "negative":
        payload["reviews"][0]["review_count"] = -1
    elif mutation == "bad_id":
        payload["cards"][0]["id"] = True
    elif mutation == "bad_date":
        payload["cards"][0]["created_at"] = "yesterday"
    elif mutation == "unknown":
        payload["cards"][0]["surprise"] = True
    elif mutation == "missing":
        del payload["hard_cards"]
    elif mutation == "timezone":
        payload["learning_events"][0]["learning_timezone"] = "not/a/zone"
    elif mutation == "event_command":
        payload["learning_events"][0]["command_json"]["card_id"] = 999
    elif mutation == "event_cache":
        payload["learning_events"][0]["response"]["sentence_card_id"] = 999
    elif mutation == "event_uuid":
        payload["learning_events"][0]["submission_id"] = "broken"
    elif mutation == "event_day":
        payload["learning_events"][0]["learning_day"] = "2026-02-30"
    elif mutation == "nested_nan":
        payload["cards"][0]["contexts"] = [{"number": float("inf")}]
    else:
        event = copy.deepcopy(payload["learning_events"][0])
        event["id"] = str(uuid4())
        payload["learning_events"].append(event)
    import json

    response = ec.client.post(
        "/api/import/preview",
        content=json.dumps(payload),
        headers={"content-type": "application/json"},
    )
    assert response.status_code == 422, response.text
    assert ec.snapshot() == before
    result = ec.client.post(
        "/api/import/cards",
        content=json.dumps({"backup": payload, "expected_revision": "invalid"}),
        headers={"content-type": "application/json"},
    )
    assert result.status_code == 422
    assert ec.snapshot() == before


def _seed_full(ec):
    from app.models.hard_card import HardCard
    from app.models.lesson import Lesson
    from app.models.story import Story, StoryWord

    word = ec.seed_card(
        "apple",
        id=101,
        example="I eat an apple.",
        example_cn="我吃苹果。",
        contexts=[{"text": "apple"}],
        related_words=[{"word": "pear"}],
    )
    sentence = ec.seed_card(
        "apple",
        kind="sentence",
        id=202,
        example="I eat an apple.",
        chunks=[{"text": "an apple", "role": "predicate"}],
        difficulty="basic",
    )
    legacy = {
        "cards": [{"id": word, "word": "apple", "kind": "word"}],
        "reviews": [
            {
                "card_id": word,
                "state": 2,
                "due": "2026-10-29T00:00:00",
                "last_review": "2026-10-28T00:00:00",
                "review_count": 4,
                "stability": 3,
                "difficulty": 5,
            }
        ],
    }
    assert ec.client.post("/api/import/cards", json=legacy).status_code == 200
    assert (
        ec.client.post(
            "/api/reviews",
            json={
                "card_id": word,
                "rating": 1,
                "source": "study",
                "submission_id": str(uuid4()),
            },
        ).status_code
        == 200
    )
    assert (
        ec.client.put(
            f"/api/memos/{sentence}", json={"content": "句子记忆"}
        ).status_code
        == 200
    )
    with ec.SessionLocal() as db:
        db.add_all(
            [
                Lesson(
                    id=71,
                    level=1,
                    title="Lesson",
                    content={"words": ["apple"], "dialogue": []},
                ),
                Story(
                    id=81,
                    title="Apple story",
                    content="An apple.",
                    title_cn="苹果",
                    content_cn="一个苹果。",
                ),
                HardCard(card_id=sentence),
            ]
        )
        db.flush()
        db.add_all(
            [
                StoryWord(story_id=81, card_id=word),
                StoryWord(story_id=81, card_id=sentence),
            ]
        )
        db.commit()
    return ec.client.get("/api/export/backup").json()


def _semantic(payload):
    """Independent business comparison: use stable words/kinds/titles as references."""
    payload = copy.deepcopy(payload)
    cards = {row["id"]: (row["word"], row["kind"]) for row in payload["cards"]}
    stories = {row["id"]: row["title"] for row in payload["stories"]}
    for key in ("exported_at", "learning_timezone", "version"):
        payload.pop(key, None)
    for name, rows in payload.items():
        for row in rows:
            row.pop("id", None)
            if "card_id" in row:
                row["card_id"] = cards[row["card_id"]]
            if "story_id" in row:
                row["story_id"] = stories[row["story_id"]]
            if name == "learning_events":
                row.pop("fingerprint")
                row["command_json"]["card_id"] = cards[row["command_json"]["card_id"]]
                question = row["command_json"].get("question")
                if question:
                    question["card_id"] = cards[question["card_id"]]
                for key in ("card_id", "sentence_card_id"):
                    if row["response"].get(key) is not None:
                        row["response"][key] = cards[row["response"][key]]
        rows.sort(key=lambda row: repr(sorted(row.items())))
    return payload


def test_full_roundtrip_all_entities_repeat_and_usable_safety_backup(ec, ec_factory):
    import json
    from pathlib import Path

    backup = _seed_full(ec)
    other = ec_factory()
    _seed_full(other)
    other.seed_card("target-only", id=999)
    before = other.snapshot()
    preview = other.client.post("/api/import/preview", json=backup)
    assert preview.status_code == 200, preview.text
    assert preview.json()["counts"]["story_words"] == 2
    assert preview.json()["impact"]["replaced"]["cards"] == 3
    assert other.snapshot() == before
    for _ in range(2):
        result = other.client.post(
            "/api/import/cards",
            json={
                "backup": backup,
                "expected_revision": preview.json()["expected_revision"],
            },
        )
        assert result.status_code == 200, result.text
        after = other.client.get("/api/export/backup").json()
        assert _semantic(after) == _semantic(backup)
        preview = other.client.post("/api/import/preview", json=backup)
    safety = json.loads(Path(result.json()["safety_backup_path"]).read_text())
    third = ec_factory()
    assert third.client.post("/api/import/cards", json=safety).status_code == 200
    assert _semantic(third.client.get("/api/export/backup").json()) == _semantic(backup)
    event = after["learning_events"][0]
    assert event["response"]["sentence_card_id"] == next(
        c["id"] for c in after["cards"] if c["kind"] == "sentence"
    )
    assert after["review_baselines"][0]["raw"] == backup["review_baselines"][0]["raw"]


def test_signed_submission_replays_after_restore_without_source_secret(ec, ec_factory):
    for word, cid in (("apple", 101), ("pear", 102), ("orange", 103), ("banana", 104)):
        ec.seed_card(word, id=cid)
    question = ec.client.get("/api/listening?limit=1").json()["questions"][0]
    command = {
        "card_id": question["card_id"],
        "answer": question["word"],
        "source": "listening",
        "kind": "choice",
        "submission_id": str(uuid4()),
        "question_token": question["question_token"],
    }
    first = ec.client.post("/api/listening/score", json=command)
    assert first.status_code == 200, first.text
    backup = ec.client.get("/api/export/backup").json()
    other = ec_factory()
    assert other.client.post("/api/import/cards", json=backup).status_code == 200
    mapped = next(
        c["id"]
        for c in other.client.get("/api/cards").json()["cards"]
        if c["word"] == question["word"]
    )
    other.restart()
    replay = other.client.post(
        "/api/listening/score", json={**command, "card_id": mapped}
    )
    assert replay.status_code == 200, replay.text
    before = other.snapshot()
    conflict = other.client.post(
        "/api/listening/score",
        json={
            **command,
            "card_id": mapped,
            "answer": next(o for o in question["options"] if o != question["word"]),
        },
    )
    assert conflict.status_code == 409
    new_command = other.client.post(
        "/api/listening/score",
        json={**command, "card_id": mapped, "submission_id": str(uuid4())},
    )
    assert new_command.status_code == 409
    assert other.snapshot() == before


@pytest.mark.parametrize(
    "sequence", ["direct", "empty_then_full", "empty_restart_full"]
)
def test_response_started_before_restore_cannot_overwrite_restored_content(
    ec, ec_factory, monkeypatch, sequence
):
    import json
    import threading
    from datetime import datetime
    from types import SimpleNamespace

    import app.db
    from app.models.review import Review

    entered, release, finished = threading.Event(), threading.Event(), threading.Event()

    def complete(**_kwargs):
        entered.set()
        assert release.wait(10)
        return SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(
                        content=json.dumps(
                            {"example": "STALE AI CONTENT", "example_cn": "过期"}
                        )
                    )
                )
            ]
        )

    ec.app.state.llm_client = SimpleNamespace(
        chat=SimpleNamespace(completions=SimpleNamespace(create=complete))
    )
    monkeypatch.setattr(app.db, "SessionLocal", ec.SessionLocal)
    cid = ec.seed_card(id=1, example="Original example.", example_cn="原文")
    with ec.SessionLocal() as db:
        db.add(
            Review(
                card_id=cid,
                state=1,
                step=0,
                due=datetime(2026, 10, 30),
                stability=1,
                difficulty=5,
                elapsed_days=0,
                review_count=2,
            )
        )
        db.commit()
    # The request starts the real post-commit upgrade at the external LLM boundary.
    assert (
        ec.client.post(
            "/api/reviews", json={"card_id": cid, "rating": 3, "source": "study"}
        ).status_code
        == 200
    )
    assert entered.wait(5)
    backup = ec.client.get("/api/export/backup").json()
    if sequence != "direct":
        empty = ec_factory().client.get("/api/export/backup").json()
        assert ec.client.post("/api/import/cards", json=empty).status_code == 200
        if sequence == "empty_restart_full":
            ec.restart()
    assert ec.client.post("/api/import/cards", json=backup).status_code == 200
    # Observe completion by the external connection lifecycle, without sleep races.
    from sqlalchemy import event

    event.listen(ec.engine, "checkin", lambda *_: finished.set())
    release.set()
    assert finished.wait(5)
    cards = ec.client.get("/api/export/backup").json()["cards"]
    assert [c["example"] for c in cards] == ["Original example.", "Original example."]


@pytest.mark.parametrize("fault", ["safety_disk", "insert", "commit"])
def test_full_restore_faults_preserve_entire_target_and_safety_copy(
    ec, ec_factory, monkeypatch, fault
):
    import json

    from sqlalchemy import event

    from app.services import restore

    backup = _seed_full(ec)
    target = ec_factory()
    _seed_full(target)
    target.seed_card("target-only")
    before = target.snapshot()
    if fault == "safety_disk":

        def fail(*_args, **_kwargs):
            raise OSError("disk full")

        monkeypatch.setattr(restore.os, "replace", fail)
    elif fault == "insert":

        def fail(_conn, _cursor, statement, _parameters, _context, _many):
            if statement.startswith("INSERT INTO lessons"):
                raise RuntimeError("injected SQL failure after cards")

        event.listen(target.engine, "before_cursor_execute", fail)
    else:
        target.fail_commit_once()
    result = target.client.post("/api/import/cards", json=backup)
    assert result.status_code == 500, result.text
    assert target.snapshot() == before
    if fault != "safety_disk":
        copies = list((target.root / "backups").glob("before-restore-*.json"))
        assert copies
        saved = [json.loads(path.read_text()) for path in copies]
        assert any(
            {k: v for k, v in p.items() if k != "exported_at"} == before for p in saved
        )


def test_full_restore_revision_checked_after_preview_and_concurrent_learning(
    ec, ec_factory
):
    backup = _seed_full(ec)
    target = ec_factory()
    cid = target.seed_card("keep")
    preview = target.client.post("/api/import/preview", json=backup).json()
    assert (
        target.client.post(
            "/api/reviews", json={"card_id": cid, "rating": 3}
        ).status_code
        == 200
    )
    before = target.snapshot()
    result = target.client.post(
        "/api/import/cards",
        json={"backup": backup, "expected_revision": preview["expected_revision"]},
    )
    assert result.status_code == 409
    assert target.snapshot() == before


def test_full_restore_lock_serializes_learning_and_rechecks_revision(
    ec, ec_factory, monkeypatch
):
    import threading
    from concurrent.futures import ThreadPoolExecutor

    from app.services import restore

    backup = _seed_full(ec)
    target = ec_factory()
    cid = target.seed_card("keep")
    preview = target.client.post("/api/import/preview", json=backup).json()
    entered, release = threading.Event(), threading.Event()
    replace = restore.os.replace

    def blocked_replace(*args, **kwargs):
        entered.set()
        assert release.wait(10)
        return replace(*args, **kwargs)

    monkeypatch.setattr(restore.os, "replace", blocked_replace)
    with ThreadPoolExecutor(max_workers=2) as executor:
        future = executor.submit(
            target.client.post,
            "/api/import/cards",
            json={"backup": backup, "expected_revision": preview["expected_revision"]},
        )
        assert entered.wait(5)
        attempt = executor.submit(
            target.client.post, "/api/reviews", json={"card_id": cid, "rating": 3}
        )
        release.set()
        assert future.result().status_code == 200
        assert attempt.result().status_code == 404  # old target identity was replaced
    assert _semantic(target.client.get("/api/export/backup").json()) == _semantic(
        backup
    )


def test_empty_full_backup_explicit_preview_and_replacement(ec, ec_factory):
    backup = ec.client.get("/api/export/backup").json()
    target = ec_factory()
    _seed_full(target)
    before = target.snapshot()
    preview = target.client.post("/api/import/preview", json=backup)
    assert preview.status_code == 200
    assert preview.json()["mode"] == "full_replace"
    assert set(preview.json()["counts"].values()) == {0}
    assert preview.json()["impact"]["replaced"]["cards"] == 2
    assert target.snapshot() == before
    result = target.client.post(
        "/api/import/cards",
        json={
            "backup": backup,
            "expected_revision": preview.json()["expected_revision"],
        },
    )
    assert result.status_code == 200
    assert _semantic(target.client.get("/api/export/backup").json()) == _semantic(
        backup
    )


@pytest.mark.parametrize(
    "mutation",
    [
        "coerced_count",
        "bad_summary",
        "bad_fingerprint",
        "unknown_command",
        "bad_event_kind",
        "missing_command",
        "bad_question",
        "bad_exported_date",
        "bad_baseline_kind",
    ],
)
def test_full_snapshot_rejects_corrupt_replay_contract(ec, mutation):
    payload = _seed_full(ec)
    row = payload["learning_events"][0]
    if mutation == "coerced_count":
        payload["reviews"][0]["review_count"] = "5"
    elif mutation == "bad_summary":
        row["before"]["state"] = 99
    elif mutation == "bad_fingerprint":
        row["fingerprint"] = "0" * 64
    elif mutation == "unknown_command":
        row["command_json"]["surprise"] = "ignored"
    elif mutation == "bad_event_kind":
        row["kind"] = "typed"
    elif mutation == "missing_command":
        del row["command_json"]["source"]
    elif mutation == "bad_question":
        row["command_json"]["question"] = {
            "card_id": row["card_id"],
            "kind": "self_rating",
            "options": ["apple"],
            "expected": "apple",
        }
    elif mutation == "bad_exported_date":
        payload["exported_at"] = 1
    else:
        payload["review_baselines"][0]["source_kind"] = "invented"
    before = ec.snapshot()
    result = ec.client.post("/api/import/preview", json=payload)
    assert result.status_code == 422, result.text
    assert ec.snapshot() == before


def test_full_restore_accepts_legacy_new_state_without_fabricating_events(
    ec, ec_factory
):
    ec.seed_card(id=10)
    assert (
        ec.client.post(
            "/api/import/cards",
            json={
                "cards": [{"id": 1, "word": "apple"}],
                "reviews": [{"card_id": 1, "state": 0}],
            },
        ).status_code
        == 200
    )
    backup = ec.client.get("/api/export/backup").json()
    other = ec_factory()
    result = other.client.post("/api/import/cards", json=backup)
    assert result.status_code == 200, result.text
    restored = other.client.get("/api/export/backup").json()
    assert restored["reviews"][0]["state"] == 0
    assert restored["learning_events"] == []


@pytest.mark.parametrize(
    "mutation",
    [
        "command_expected",
        "cached_due",
        "baseline_fingerprint",
        "source_review_id",
        "numeric_export_time",
        "numeric_version",
    ],
)
def test_full_snapshot_rejects_invalid_audit_fields(ec, mutation):
    payload = _seed_full(ec)
    if mutation == "command_expected":
        payload["learning_events"][0]["command_json"]["expected"] = {"wrong": "type"}
    elif mutation == "cached_due":
        payload["learning_events"][0]["response"]["next_due"] = "tomorrow"
    elif mutation == "baseline_fingerprint":
        payload["review_baselines"][0]["source_fingerprint"] = "garbage"
    elif mutation == "source_review_id":
        payload["review_baselines"][0]["source_review_id"] = -1
    elif mutation == "numeric_export_time":
        payload["exported_at"] = 1
    else:
        payload["version"] = 2.0
    result = ec.client.post("/api/import/preview", json=payload)
    assert result.status_code == 422, result.text
