"""EL-14: public scene tasks, first responses and recoverable evidence."""

from uuid import uuid4


def create_scene(ec, session_id=None):
    return ec.client.post(
        "/api/practice-sessions",
        json={
            "id": session_id or str(uuid4()),
            "purpose": "scene",
            "scene_id": "drinks",
        },
    )


def test_el14_scene_starts_without_word_scheduling(ec):
    response = create_scene(ec)
    assert response.status_code == 200, response.text
    run = response.json()
    assert run["scene_id"] == "drinks"
    assert len(run["items"]) == 3
    assert run["status"] == "incomplete"
    assert [row["kind"] for row in run["items"]] == ["scene_text"] * 3
    assert "Can I have" not in str(run)
    assert ec.client.get("/api/stats").json()["reviewed_today"] == 0


def answer(ec, run, index, text=None, submission_id=None, **extra):
    return ec.client.post(
        f"/api/practice-sessions/{run['id']}/items/{run['items'][index]['id']}/attempts",
        json={"submission_id": submission_id or str(uuid4()), "answer": text, **extra},
    )


def test_el14_three_independent_first_answers_complete_without_fsrs(ec):
    ec.seed_card(word="water", meaning="水", example="Water is good.")
    run = create_scene(ec).json()
    for index, text in enumerate(
        ["Can I have water, please?", "One cup, please.", "Yes, thank you."]
    ):
        saved = answer(ec, run, index, text)
        assert saved.status_code == 200, saved.text
        assert saved.json()["verdict"] == "accepted"
        run = saved.json()["session"]
        assert run["counts"]["processed"] == index + 1
        assert run["status"] == ("independent" if index == 2 else "incomplete")
    backup = ec.client.get("/api/export/backup").json()
    assert backup["learning_events"] == []
    assert backup["reviews"] == []
    stats = ec.client.get("/api/stats").json()
    assert stats["reviewed_today"] == 0
    card = ec.client.get("/api/cards/1").json()
    assert card["learning_evidence"]["application"]["status"] == "verified"


def test_el14_v3_restores_scene_and_replays_the_same_submission(ec, ec_factory):
    from tests.test_el11_bounded_personalized_story import restore

    ec.seed_card(word="water", meaning="水")
    run = create_scene(ec).json()
    submission_id = str(uuid4())
    saved = answer(ec, run, 0, "Can I have water, please?", submission_id)
    assert saved.status_code == 200
    backup = ec.client.get("/api/export/backup").json()
    assert len(backup["extensions"]["scene_attempts"]) == 1
    target = ec_factory()
    target.seed_card(word="retired")
    restore(target, backup)
    resumed = target.client.get(f"/api/practice-sessions/{run['id']}").json()
    assert resumed["counts"]["processed"] == 1
    replay = answer(target, resumed, 0, "Can I have water, please?", submission_id)
    assert replay.status_code == 200, replay.text
    assert replay.json() == saved.json()
    assert answer(target, resumed, 1, "One cup, please.").status_code == 200


def test_el14_preparation_reports_real_recall_readiness(ec):
    ec.seed_card(word="water", meaning="水")
    run = create_scene(ec).json()
    assert run["preparation"]["targets"][0]["meaning"] == "水"
    assert run["preparation"]["ready"] is False
    assert run["preparation"]["missing_words"] == ["one", "thank"]


def test_el14_scene_submission_identity_cannot_be_reused_for_word_learning(ec):
    card_id = ec.seed_card(word="water", meaning="水")
    run = create_scene(ec).json()
    submission_id = str(uuid4())
    assert (
        answer(ec, run, 0, "Can I have water, please?", submission_id).status_code
        == 200
    )
    collision = ec.client.post(
        "/api/typing/check",
        json={
            "card_id": card_id,
            "user_input": "water",
            "source": "spelling",
            "submission_id": submission_id,
        },
    )
    assert collision.status_code == 409, collision.text
    assert ec.client.get("/api/export/backup").json()["learning_events"] == []


def test_el14_unknown_rejected_empty_skip_and_first_response_are_distinct(ec):
    run = create_scene(ec).json()
    assert answer(ec, run, 0, "").status_code == 422
    assert answer(ec, run, 1, "one").status_code == 422
    # Complete words without a request do not satisfy a request task.
    first = answer(ec, run, 0, "water")
    assert first.json()["verdict"] == "rejected"
    retried = answer(ec, run, 0, "Can I have water, please?")
    assert retried.json()["verdict"] == "accepted"
    assert retried.json()["first_response"] is False
    assert retried.json()["session"]["items"][0]["verdict"] == "rejected"
    unknown = answer(ec, run, 1, "A single glass would be lovely.")
    assert unknown.json()["verdict"] == "unknown"
    skipped = answer(ec, run, 2, skipped=True)
    assert skipped.json()["session"]["status"] == "completed"
    assert skipped.json()["session"]["items"][2]["skipped"] is True
    assert skipped.json()["session"]["counts"]["processed"] == 3
    assert (
        len(ec.client.get("/api/export/backup").json()["extensions"]["scene_attempts"])
        == 4
    )


def test_el14_saved_help_survives_reopen_and_copy_is_not_transfer(ec):
    card_id = ec.seed_card(
        word="water", meaning="水", example="Can I have water, please?"
    )
    run = create_scene(ec).json()
    # Even an independent response copied from stored teaching is not new context.
    saved = None
    for index, text in enumerate(
        ["Can I have water, please?", "One cup, please.", "Yes, thank you."]
    ):
        saved = answer(ec, run, index, text)
        assert saved.status_code == 200, saved.text
    assert saved is not None
    assert saved.json()["session"]["status"] == "independent"
    assert (
        ec.client.get(f"/api/cards/{card_id}").json()["learning_evidence"][
            "application"
        ]["status"]
        == "insufficient"
    )
    helped = create_scene(ec).json()
    url = f"/api/practice-sessions/{helped['id']}/items/{helped['items'][0]['id']}/assistance"
    assert ec.client.post(url, json={"kind": "answer_visible"}).status_code == 200
    reopened = ec.client.get(f"/api/practice-sessions/{helped['id']}").json()
    assert reopened["items"][0]["standard"] == "Can I have water, please?"
    result = None
    for index, text in enumerate(
        ["Can I have water, please?", "One cup, please.", "Yes, thank you."]
    ):
        result = answer(ec, reopened, index, text)
        assert result.status_code == 200, result.text
    assert result is not None
    assert result.json()["session"]["status"] == "completed"
    assert result.json()["session"]["items"][0]["assistance"] == ["answer_visible"]


def test_el14_commit_failure_retries_and_concurrent_confirmation_are_atomic(ec):
    from concurrent.futures import ThreadPoolExecutor

    session_id = str(uuid4())
    before = ec.snapshot()
    ec.fail_commit_once()
    assert create_scene(ec, session_id).status_code == 500
    assert ec.snapshot() == before
    run = create_scene(ec, session_id).json()
    before = ec.snapshot()
    submission_id = str(uuid4())
    ec.fail_commit_once()
    assert (
        answer(ec, run, 0, "Can I have water, please?", submission_id).status_code
        == 500
    )
    assert ec.snapshot() == before
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(
                lambda _: answer(
                    ec, run, 0, "Can I have water, please?", submission_id
                ),
                range(2),
            )
        )
    assert [r.status_code for r in responses] == [200, 200]
    assert responses[0].json() == responses[1].json()
    assert answer(ec, run, 0, "other", submission_id).status_code == 409
    after = ec.client.get("/api/export/backup").json()
    assert len(after["extensions"]["scene_attempts"]) == 1
    assert after["extensions"]["practice_sessions"][0]["status"] == "active"


def test_el14_deleted_target_prevents_later_turns_but_preserves_saved_replay(ec):
    card_id = ec.seed_card(word="water", meaning="水")
    run = create_scene(ec).json()
    submission_id = str(uuid4())
    saved = answer(ec, run, 0, "Can I have water, please?", submission_id)
    assert ec.client.delete(f"/api/cards/{card_id}").status_code == 200
    assert (
        answer(ec, run, 0, "Can I have water, please?", submission_id).json()
        == saved.json()
    )
    blocked = answer(ec, run, 1, "one")
    assert blocked.status_code == 404, blocked.text
    reopened = ec.client.get(f"/api/practice-sessions/{run['id']}").json()
    assert "删除" in reopened["message"]
    assert reopened["counts"]["processed"] == 1


def test_el14_functional_rollback_preserves_confirmation_and_history(ec):
    run = create_scene(ec).json()
    ec.settings.scenes_enabled = False
    assert ec.client.get("/api/today").json()["scenes_enabled"] is False
    assert create_scene(ec).status_code == 403
    # A response lost before rollback must still confirm its original creation.
    replay = create_scene(ec, run["id"])
    assert replay.status_code == 200, replay.text
    assert answer(ec, run, 0, "Can I have water, please?").status_code == 200
    assert ec.client.get(f"/api/practice-sessions/{run['id']}").status_code == 200
    assert (
        len(
            ec.client.get("/api/export/backup").json()["extensions"][
                "practice_sessions"
            ]
        )
        == 1
    )


def test_el14_rollback_marks_application_as_historical(ec):
    card_id = ec.seed_card(word="water", meaning="水")
    run = create_scene(ec).json()
    for index, text in enumerate(
        ["Can I have water, please?", "one", "Yes, thank you."]
    ):
        assert answer(ec, run, index, text).status_code == 200
    assert (
        ec.client.get(f"/api/cards/{card_id}").json()["learning_evidence"][
            "application"
        ]["status"]
        == "verified"
    )
    ec.settings.scenes_enabled = False
    ec.restart()
    application = ec.client.get(f"/api/cards/{card_id}").json()["learning_evidence"][
        "application"
    ]
    assert application["status"] == "stale"
    assert "历史" in application["label"]


def test_el14_restore_rejects_malformed_command_without_a_server_error(ec):
    run = create_scene(ec).json()
    assert answer(ec, run, 0, "Can I have water, please?").status_code == 200
    backup = ec.client.get("/api/export/backup").json()
    backup["extensions"]["scene_attempts"][0]["command_json"]["client_assistance"] = [
        {}
    ]
    before = ec.snapshot()
    response = ec.client.post("/api/import/preview", json=backup)
    assert response.status_code == 422, response.text
    assert ec.snapshot() == before


def test_el14_restore_rejects_a_forged_completed_cached_result(ec):
    run = create_scene(ec).json()
    assert answer(ec, run, 0, "Can I have water, please?").status_code == 200
    backup = ec.client.get("/api/export/backup").json()
    backup["extensions"]["scene_attempts"][0]["response"]["session"]["status"] = (
        "independent"
    )
    response = ec.client.post("/api/import/preview", json=backup)
    assert response.status_code == 422, response.text


def test_el14_same_taught_task_with_different_wording_is_not_new_context(ec):
    card_id = ec.seed_card(
        word="water", meaning="水", example="Could I have water, please?"
    )
    run = create_scene(ec).json()
    for index, text in enumerate(
        ["Can I have water, please?", "one", "Yes, thank you."]
    ):
        assert answer(ec, run, index, text).status_code == 200
    assert (
        ec.client.get(f"/api/cards/{card_id}").json()["learning_evidence"][
            "application"
        ]["status"]
        == "insufficient"
    )


def test_el14_rollback_does_not_invent_historical_evidence_for_unattempted_words(ec):
    card_id = ec.seed_card(word="water", meaning="水")
    ec.settings.scenes_enabled = False
    ec.restart()
    assert (
        ec.client.get(f"/api/cards/{card_id}").json()["learning_evidence"][
            "application"
        ]["status"]
        == "insufficient"
    )


def test_el14_taught_dialogue_context_is_not_new_application(ec):
    card_id = ec.seed_card(
        word="water",
        meaning="水",
        contexts=[{"en": "Can I have water, please?", "cn": "可以给我水吗？"}],
    )
    run = create_scene(ec).json()
    for index, text in enumerate(
        ["Can I have water, please?", "one", "Yes, thank you."]
    ):
        assert answer(ec, run, index, text).status_code == 200
    assert (
        ec.client.get(f"/api/cards/{card_id}").json()["learning_evidence"][
            "application"
        ]["status"]
        == "insufficient"
    )


def test_el14_backup_cannot_attach_a_water_task_to_an_untested_word(ec):
    ec.seed_card(word="water", meaning="水")
    run = create_scene(ec).json()
    assert answer(ec, run, 0, "Can I have water, please?").status_code == 200
    backup = ec.client.get("/api/export/backup").json()
    backup["cards"][0]["word"] = "apple"
    response = ec.client.post("/api/import/preview", json=backup)
    assert response.status_code == 422, response.text


def test_el14_restore_keeps_same_time_first_response_order(ec, ec_factory):
    from tests.test_el11_bounded_personalized_story import restore

    ec.seed_card(word="water", meaning="水")
    run = create_scene(ec).json()
    for index, text in enumerate(
        ["Can I have water, please?", "one", "Yes, thank you."]
    ):
        assert answer(ec, run, index, text).status_code == 200
    later = create_scene(ec).json()
    assert answer(ec, later, 0, "water").status_code == 200
    backup = ec.client.get("/api/export/backup").json()
    backup["extensions"]["scene_attempts"].reverse()
    target = ec_factory()
    restore(target, backup)
    card_id = target.client.get("/api/export/backup").json()["cards"][0]["id"]
    assert (
        target.client.get(f"/api/cards/{card_id}").json()["learning_evidence"][
            "application"
        ]["status"]
        == "weak"
    )


def test_el14_upgrade_preserves_a_delivered_word_practice_round(tmp_path):
    import sqlite3
    from pathlib import Path

    from alembic.config import Config

    from alembic import command
    from tests.support.ec_env import ECEnv

    root = tmp_path / "delivered"
    root.mkdir()
    path = root / "test.db"
    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{path}")
    command.upgrade(config, "el13_merge_story_heads")
    session_id, item_id, identity = (str(uuid4()) for _ in range(3))
    with sqlite3.connect(path) as db:
        db.execute(
            "INSERT INTO cards (id, word, meaning, kind) VALUES (1, 'water', '水', 'word')"
        )
        db.execute(
            "INSERT INTO content_revisions (resource_kind, resource_id, identity, version) VALUES ('card', 1, ?, 1)",
            (identity,),
        )
        db.execute(
            "INSERT INTO practice_sessions (session_id, purpose, status, rule_version, created_at, pending_contact_ids) VALUES (?, 'targeted', 'active', 'el10-v1', '2026-10-30 12:00:00', '[]')",
            (session_id,),
        )
        db.execute(
            "INSERT INTO practice_items (item_id, session_id, position, card_id, card_identity, card_revision, prompt, kind, assistance, created_at) VALUES (?, ?, 1, 1, ?, 1, '水', 'typed', '[]', '2026-10-30 12:00:00')",
            (item_id, session_id, identity),
        )
    env = ECEnv(root=root)
    try:
        existing = env.client.get(f"/api/practice-sessions/{session_id}")
        assert existing.status_code == 200, existing.text
        assert existing.json()["items"][0]["id"] == item_id
        assert answer(env, existing.json(), 0, "water").status_code == 200
        assert create_scene(env).status_code == 200
        assert (
            env.client.get("/api/export/backup").json()["learning_events"][0][
                "scheduled"
            ]
            is True
        )
    finally:
        env.close()


def test_el14_cached_response_cannot_hide_its_own_saved_first_answer(ec):
    run = create_scene(ec).json()
    assert answer(ec, run, 0, "Can I have water, please?").status_code == 200
    backup = ec.client.get("/api/export/backup").json()
    cached = backup["extensions"]["scene_attempts"][0]["response"]["session"]
    cached["items"][0].update(processed=False, verdict=None, skipped=False)
    cached["counts"]["processed"] = 0
    cached["status"] = "incomplete"
    response = ec.client.post("/api/import/preview", json=backup)
    assert response.status_code == 422, response.text


def test_el14_a_previous_shown_scene_standard_is_still_taught_context(ec):
    card_id = ec.seed_card(word="water", meaning="水")
    helped = create_scene(ec).json()
    assert (
        ec.client.post(
            f"/api/practice-sessions/{helped['id']}/items/{helped['items'][0]['id']}/assistance",
            json={"kind": "answer_visible"},
        ).status_code
        == 200
    )
    fresh = create_scene(ec).json()
    for index, text in enumerate(
        ["Can I have water, please?", "one", "Yes, thank you."]
    ):
        assert answer(ec, fresh, index, text).status_code == 200
    assert (
        ec.client.get(f"/api/cards/{card_id}").json()["learning_evidence"][
            "application"
        ]["status"]
        == "insufficient"
    )


def test_el14_schema_rollback_refuses_to_remove_scene_history(ec):
    import pytest
    from alembic.config import Config

    from alembic import command

    run = create_scene(ec).json()
    assert answer(ec, run, 0, "Can I have water, please?").status_code == 200
    before = ec.snapshot()
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", ec.database_url)
    # The newest delivered migration must stop first; the historical EL-14
    # barrier is exercised separately on its actual schema in EL-21.
    with pytest.raises(
        RuntimeError,
        match="Keep saved replay identities; roll back the feature instead",
    ):
        command.downgrade(config, "el13_merge_story_heads")
    assert ec.snapshot() == before


def test_el14_an_item_from_another_scene_cannot_be_read_or_written(ec):
    first, second = create_scene(ec).json(), create_scene(ec).json()
    before = ec.snapshot()
    path = f"/api/practice-sessions/{first['id']}/items/{second['items'][0]['id']}"
    assert (
        ec.client.post(
            path + "/attempts", json={"submission_id": str(uuid4()), "answer": "water"}
        ).status_code
        == 404
    )
    assert (
        ec.client.post(
            path + "/assistance", json={"kind": "answer_visible"}
        ).status_code
        == 404
    )
    assert ec.snapshot() == before
