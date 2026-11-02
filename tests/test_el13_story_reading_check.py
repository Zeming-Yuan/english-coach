"""EL-13 public HTTP: frozen reading recognition and independent/assisted input."""

from uuid import uuid4

from tests.test_el11_bounded_personalized_story import _generate, restore, verified


def create_check(ec, story=None, session_id=None):
    if story is None:
        verified(ec)
        story = _generate(ec).json()
    response = ec.client.post(
        "/api/practice-sessions",
        json={
            "id": session_id or str(uuid4()),
            "purpose": "story_check",
            "story_id": story["id"],
            "version_id": story["version_id"],
        },
    )
    return response


def attempt(ec, run, index, answer="apple", submission_id=None):
    return ec.client.post(
        f"/api/practice-sessions/{run['id']}/items/{run['items'][index]['id']}/attempts",
        json={"submission_id": submission_id or str(uuid4()), "answer": answer},
    )


def test_el13_reading_recognition_and_independent_input_have_separate_scheduling(ec):
    created = create_check(ec)
    assert created.status_code == 200, created.text
    run = created.json()
    assert [i["kind"] for i in run["items"]] == ["reading_choice", "typed"]
    assert run["items"][0]["options"] == ["apple", "book", "water"]
    assert "expected" not in run["items"][0]
    assert "apple" not in str(run["items"][1])
    ec.set_time("2026-10-03T03:00:00Z")
    assert ec.client.get("/api/stats").json()["reviewed_today"] == 0
    before = ec.snapshot()["reviews"]
    choice = attempt(ec, run, 0)
    assert choice.status_code == 200, choice.text
    assert ec.snapshot()["reviews"] == before
    assert ec.client.get("/api/stats").json()["reviewed_today"] == 0
    typed = attempt(ec, run, 1)
    assert typed.status_code == 200, typed.text
    stats = ec.client.get("/api/stats").json()
    assert stats["reviewed_today"] == 1
    assert stats["retention"]["day"]["count"] == 0
    events = [e for e in ec.snapshot()["learning_events"] if e["source"] == "story"]
    assert [(e["kind"], e["scheduled"]) for e in events] == [
        ("choice", False),
        ("typed", True),
    ]
    assert typed.json()["session"]["reading_checks"] == {
        "recognition_count": 1,
        "independent_count": 1,
        "assisted_count": 0,
    }


def test_el13_reopening_help_and_first_result_survive_v3_restore(ec, ec_factory):
    run = create_check(ec).json()
    assert attempt(ec, run, 0).status_code == 200
    help_url = (
        f"/api/practice-sessions/{run['id']}/items/{run['items'][1]['id']}/assistance"
    )
    helped = ec.client.post(help_url, json={"kind": "answer_visible"})
    assert helped.status_code == 200, helped.text
    backup = ec.client.get("/api/export/backup").json()
    target = ec_factory()
    target.seed_card(word="retired")
    restore(target, backup)
    resumed = target.client.get(f"/api/practice-sessions/{run['id']}").json()
    assert resumed["version_id"] == run["version_id"]
    assert resumed["items"][1]["assistance"] == ["answer_visible"]
    saved = attempt(target, resumed, 1)
    assert saved.status_code == 200, saved.text
    event = next(
        e
        for e in target.snapshot()["learning_events"]
        if e["source"] == "story" and e["kind"] == "typed"
    )
    assert event["scheduled"] is False
    assert event["assistance"] == ["answer_visible"]
    assert attempt(target, resumed, 1, "wrong").status_code == 409
    assert saved.json()["session"]["reading_checks"]["assisted_count"] == 1


def test_el13_statistics_separate_reading_from_word_review(ec):
    response = ec.client.get("/api/stats")
    assert response.status_code == 200
    assert response.json()["reading_checks"] == {
        "recognition_count": 0,
        "independent_count": 0,
        "assisted_count": 0,
    }
    run = create_check(ec).json()
    assert attempt(ec, run, 0).status_code == 200
    assert (
        ec.client.get("/api/stats").json()["reading_checks"]["recognition_count"] == 1
    )


def test_el13_creation_replay_rejects_a_different_story_even_with_original_version(ec):
    verified(ec)
    first = _generate(ec).json()
    other = _generate(ec).json()
    session_id = str(uuid4())
    assert create_check(ec, first, session_id).status_code == 200
    changed = {**first, "id": other["id"]}
    assert create_check(ec, changed, session_id).status_code == 409


def test_el13_missing_choice_material_keeps_a_typed_only_round_restorable(
    ec, ec_factory
):
    from sqlalchemy import select

    from app.models.story_version import StoryVersion

    verified(ec)
    story = _generate(ec).json()
    with ec._session() as db:  # Prepare an older version without check material.
        version = db.scalar(select(StoryVersion))
        material = dict(version.material)
        material.pop("check")
        version.material = material
        # An old checked coverage record excludes the absent question surface.
        version.quality = {**version.quality, "unknown_forms": []}
        db.commit()
    run = create_check(ec, story)
    assert run.status_code == 200, run.text
    assert [i["kind"] for i in run.json()["items"]] == ["typed"]
    target = ec_factory()
    restore(target, ec.client.get("/api/export/backup").json())
    assert attempt(target, run.json(), 0).status_code == 200


def test_el13_functional_rollback_preserves_history_and_restore(ec, ec_factory):
    verified(ec)
    story = _generate(ec).json()
    run = create_check(ec, story).json()
    assert attempt(ec, run, 0).status_code == 200
    before = ec.snapshot()
    ec.settings.story_checks_enabled = False
    assert (
        ec.client.get(f"/api/stories/{story['id']}").json()["checks_enabled"] is False
    )
    assert create_check(ec, story).status_code == 403
    assert ec.snapshot() == before
    target = ec_factory()
    restore(target, ec.client.get("/api/export/backup").json())
    assert target.client.get(f"/api/practice-sessions/{run['id']}").status_code == 200


import pytest


@pytest.mark.parametrize("defect", ["evidence", "unverified"])
def test_el13_unvalidated_choice_is_never_issued(ec, defect):
    from sqlalchemy import select

    from app.models.story_version import StoryVersion

    verified(ec)
    story = _generate(ec).json()
    with ec._session() as db:
        version = db.scalar(select(StoryVersion))
        if defect == "evidence":
            version.material = {
                **version.material,
                "check": {
                    **version.material["check"],
                    "evidence_sentence": "wrong evidence",
                },
            }
        else:
            version.quality = {**version.quality, "known_basis": "unverified"}
        db.commit()
    run = create_check(ec, story)
    assert run.status_code == 200
    assert [i["kind"] for i in run.json()["items"]] == ["typed"]


@pytest.mark.parametrize("path", ["create", "attempt"])
def test_el13_commit_failure_is_atomic_and_confirmation_replays_once(ec, path):
    verified(ec)
    story = _generate(ec).json()
    session_id = str(uuid4())
    if path == "create":
        send = lambda: create_check(ec, story, session_id)
    else:
        run = create_check(ec, story, session_id).json()
        submission_id = str(uuid4())
        send = lambda: attempt(ec, run, 0, submission_id=submission_id)
    before = ec.snapshot()
    ec.fail_commit_once()
    assert send().status_code == 500
    assert ec.snapshot() == before
    saved = send()
    assert saved.status_code == 200, saved.text
    after = ec.snapshot()
    assert send().status_code == 200
    assert ec.snapshot() == after


def test_el13_concurrent_choice_and_typed_confirmations_only_write_once(ec):
    from concurrent.futures import ThreadPoolExecutor

    run = create_check(ec).json()
    for index in range(2):
        submission_id = str(uuid4())
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(
                pool.map(
                    lambda _, index=index, submission_id=submission_id: attempt(
                        ec, run, index, submission_id=submission_id
                    ),
                    range(2),
                )
            )
        assert [r.status_code for r in results] == [200, 200]
        assert results[0].json()["event_id"] == results[1].json()["event_id"]
        assert attempt(ec, run, index, "book", submission_id).status_code == 409
    assert (
        len([e for e in ec.snapshot()["learning_events"] if e["source"] == "story"])
        == 2
    )


@pytest.mark.parametrize(
    "change", ["story_revision", "story_delete", "card_revision", "card_delete"]
)
def test_el13_stale_or_deleted_content_blocks_new_answers_but_keeps_readable_results(
    ec, change
):
    from app.models.story import Story
    from app.services.content_revisions import advance_content_revision

    verified(ec)
    story = _generate(ec).json()
    run = create_check(ec, story).json()
    sid = str(uuid4())
    assert attempt(ec, run, 0, submission_id=sid).status_code == 200
    if change == "story_revision":
        with ec._session() as db:
            text = db.get(Story, story["id"])
            advance_content_revision(db, "story", text.id, {"title": "Revised apple"})
            text.title = "Revised apple"
            db.commit()
    elif change == "story_delete":
        assert ec.client.delete(f"/api/stories/{story['id']}").status_code == 200
    elif change == "card_revision":
        assert (
            ec.client.put(
                f"/api/cards/{run['items'][1]['card_id']}", json={"meaning": "新释义"}
            ).status_code
            == 200
        )
    else:
        assert (
            ec.client.delete(f"/api/cards/{run['items'][1]['card_id']}").status_code
            == 200
        )
    if change != "card_delete":
        assert attempt(ec, run, 0, submission_id=sid).status_code == 200
    blocked = attempt(ec, run, 1)
    assert blocked.status_code in (404, 409), blocked.text
    state = ec.client.get(f"/api/practice-sessions/{run['id']}")
    assert state.status_code == 200
    backup = ec.client.get("/api/export/backup").json()
    assert ec.client.post("/api/import/preview", json=backup).status_code == 200


def test_el13_restart_uses_fresh_signing_key_and_rejects_non_option(ec, ec_factory):
    run = create_check(ec).json()
    assert attempt(ec, run, 0, "not an option").status_code == 422
    target = ec_factory()
    restore(target, ec.client.get("/api/export/backup").json())
    assert attempt(target, run, 0).status_code == 200
    assert target.client.get("/api/stats").json()["retention"]["day"]["count"] == 0


@pytest.mark.parametrize("field", ["question", "version", "event_revision", "prompt"])
def test_el13_v3_rejects_broken_version_and_first_event_associations(ec, field):
    from copy import deepcopy

    run = create_check(ec).json()
    assert attempt(ec, run, 0).status_code == 200
    backup = ec.client.get("/api/export/backup").json()
    bad = deepcopy(backup)
    if field == "question":
        bad["extensions"]["practice_items"][0]["question"]["expected"] = "water"
    elif field == "version":
        bad["extensions"]["practice_sessions"][0]["version_id"] = str(uuid4())
    elif field == "event_revision":
        event = next(e for e in bad["learning_events"] if e["source"] == "story")
        event["card_identity"] = str(uuid4())
    else:
        bad["extensions"]["practice_items"][0]["prompt"] = "An unrelated question"
    before = ec.snapshot()
    rejected = ec.client.post("/api/import/preview", json=bad)
    assert rejected.status_code == 422, rejected.text
    assert ec.snapshot() == before


def test_el13_skipped_choice_feedback_uses_the_story_option_not_the_target_word(ec):
    from tests.test_el11_bounded_personalized_story import valid_story

    verified(ec)
    data = valid_story()
    data["check"].update(
        {
            "question": "What is near my cup?",
            "question_cn": "杯子旁有什么？",
            "options": ["book", "apple", "dog"],
            "options_cn": ["书", "苹果", "狗"],
            "expected": "book",
            "evidence_index": 2,
        }
    )
    story = _generate(ec, data).json()
    run = create_check(ec, story).json()
    saved = ec.client.post(
        f"/api/practice-sessions/{run['id']}/items/{run['items'][0]['id']}/attempts",
        json={"submission_id": str(uuid4()), "skipped": True},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["expected"] == "book"
    assert saved.json()["session"]["items"][0]["expected"] == "book"
    assert (
        ec.client.post(
            "/api/import/preview", json=ec.client.get("/api/export/backup").json()
        ).status_code
        == 200
    )


def test_el13_older_backup_explains_missing_reading_check_history(ec):
    backup = ec.client.get("/api/export/backup").json()
    for feature in ["story_versions", "practice_sessions", "practice_items"]:
        backup["features"].remove(feature)
        del backup["extensions"][feature]
    preview = ec.client.post("/api/import/preview", json=backup)
    assert preview.status_code == 200
    assert preview.json()["reading_check_history"] == "not_recorded"
