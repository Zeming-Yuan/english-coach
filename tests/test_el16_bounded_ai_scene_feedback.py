"""EL-16: saved scene answers receive bounded, recoverable feedback."""

from uuid import uuid4

import pytest


def saved_scene_item(ec, answer="Can I have water, please?", scene_id="drinks"):
    response = ec.client.post(
        "/api/practice-sessions",
        json={"id": str(uuid4()), "purpose": "scene", "scene_id": scene_id},
    )
    assert response.status_code == 200, response.text
    run = response.json()
    item_id = run["items"][0]["id"]
    saved = ec.client.post(
        f"/api/practice-sessions/{run['id']}/items/{item_id}/attempts",
        json={"submission_id": str(uuid4()), "answer": answer},
    )
    assert saved.status_code == 200, saved.text
    return saved.json()["session"], item_id


def request_feedback(ec, run, item_id, operation_id=None):
    return ec.client.post(
        f"/api/practice-sessions/{run['id']}/items/{item_id}/feedback",
        json={"operation_id": operation_id or str(uuid4())},
    )


def test_el16_saved_answer_gets_template_without_ai(ec):
    run, item_id = saved_scene_item(ec)
    before = ec.snapshot()
    response = request_feedback(ec, run, item_id)
    assert response.status_code == 200, response.text
    feedback = response.json()
    assert feedback["origin"] == "template"
    assert feedback["text"]
    assert feedback["correction"] is None
    assert "verdict" not in feedback
    reopened = ec.client.get(f"/api/practice-sessions/{run['id']}").json()
    assert reopened["items"][0]["feedback"] == feedback
    after = ec.snapshot()
    assert after["learning_events"] == before["learning_events"] == []
    assert after["reviews"] == before["reviews"] == []
    assert (
        after["extensions"]["scene_attempts"] == before["extensions"]["scene_attempts"]
    )


def test_el16_valid_model_expression_uses_saved_result_without_regrading(ec):
    from tests.support.llm_queue import QueuedLLM

    run, item_id = saved_scene_item(ec, answer="I would like water, please.")
    ec.app.state.llm_client = QueuedLLM(
        [
            {
                "text": "Water is ready.",
                "correction": None,
                "verdict": "rejected",
                "score": 0,
            }
        ]
    )
    response = request_feedback(ec, run, item_id)
    assert response.status_code == 200, response.text
    assert response.json()["origin"] == "model"
    assert response.json()["text"] == "Water is ready."
    reopened = ec.client.get(f"/api/practice-sessions/{run['id']}").json()
    assert reopened["items"][0]["verdict"] == "accepted"
    assert reopened["counts"]["processed"] == 1
    backup = ec.snapshot()
    assert backup["learning_events"] == backup["reviews"] == []
    assert len(backup["extensions"]["scene_attempts"]) == 1


def test_el16_v3_rejects_feedback_attached_to_an_unsaved_turn(ec):
    run, item_id = saved_scene_item(ec)
    assert request_feedback(ec, run, item_id).status_code == 200
    backup = ec.client.get("/api/export/backup").json()
    assert ec.client.post("/api/import/preview", json=backup).status_code == 200
    backup["extensions"]["scene_feedback"][0]["item_id"] = run["items"][1]["id"]
    before = ec.snapshot()
    response = ec.client.post("/api/import/preview", json=backup)
    assert response.status_code == 422, response.text
    assert ec.snapshot() == before


def test_el16_v3_roundtrip_preserves_feedback_and_first_answer_replay(ec, ec_factory):
    from tests.test_el11_bounded_personalized_story import restore

    ec.seed_card(word="water", meaning="水")
    run, item_id = saved_scene_item(ec)
    operation_id = str(uuid4())
    feedback = request_feedback(ec, run, item_id, operation_id)
    assert feedback.status_code == 200
    # The next saved response includes the earlier feedback snapshot.
    second = ec.client.post(
        f"/api/practice-sessions/{run['id']}/items/{run['items'][1]['id']}/attempts",
        json={"submission_id": str(uuid4()), "answer": "One cup, please."},
    )
    assert second.status_code == 200
    backup = ec.client.get("/api/export/backup").json()
    target = ec_factory()
    target.seed_card(word="retired", meaning="旧词")
    restore(target, backup)
    resumed = target.client.get(f"/api/practice-sessions/{run['id']}").json()
    assert resumed["items"][0]["feedback"] == feedback.json()
    assert resumed["counts"]["processed"] == 2
    assert (
        request_feedback(target, resumed, item_id, operation_id).json()
        == feedback.json()
    )
    assert len(target.snapshot()["extensions"]["scene_feedback"]) == 1


def test_el16_every_scene_template_can_roundtrip_without_leaking_standard(ec):
    for scene_id in ("drinks", "introduction", "directions"):
        run = ec.client.post(
            "/api/practice-sessions",
            json={"id": str(uuid4()), "purpose": "scene", "scene_id": scene_id},
        ).json()
        answers = {
            "drinks": [
                "Can I have water, please?",
                "One cup, please.",
                "Yes, thank you.",
            ],
            "introduction": ["My name is Li.", "I am from Beijing.", "I like tea."],
            "directions": [
                "Excuse me, where is the station?",
                "Should I turn left?",
                "Yes, thank you.",
            ],
        }[scene_id]
        for item, answer in zip(run["items"], answers):
            path = f"/api/practice-sessions/{run['id']}/items/{item['id']}"
            assert (
                ec.client.post(
                    path + "/attempts",
                    json={"submission_id": str(uuid4()), "answer": answer},
                ).status_code
                == 200
            )
            feedback = request_feedback(ec, run, item["id"])
            assert feedback.status_code == 200
            assert feedback.json()["origin"] == "template"
        backup = ec.client.get("/api/export/backup").json()
        preview = ec.client.post("/api/import/preview", json=backup)
        assert preview.status_code == 200, preview.text


@pytest.mark.parametrize("via_empty", [False, True])
def test_el16_restore_discards_a_late_response_even_for_the_same_snapshot(
    ec, ec_factory, via_empty
):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    from tests.support.llm_queue import QueuedLLM
    from tests.test_el11_bounded_personalized_story import restore

    run, item_id = saved_scene_item(ec)
    backup = ec.client.get("/api/export/backup").json()
    started, release = Event(), Event()

    class BlockingLLM(QueuedLLM):
        def create(self, **kwargs):
            started.set()
            assert release.wait(10)
            return super().create(**kwargs)

    ec.app.state.llm_client = BlockingLLM(
        [{"text": "Water is ready.", "correction": None}]
    )
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(request_feedback, ec, run, item_id)
        try:
            assert started.wait(10)
            if via_empty:
                empty = ec_factory().client.get("/api/export/backup").json()
                restore(ec, empty)
            restore(ec, backup)
        finally:
            release.set()
        response = future.result(timeout=10)
    assert response.status_code == 409, response.text
    resumed = ec.client.get(f"/api/practice-sessions/{run['id']}").json()
    assert resumed["counts"]["processed"] == 1
    assert "feedback" not in resumed["items"][0]
    assert ec.snapshot()["extensions"]["scene_feedback"] == []


def test_el16_epoch_upgrade_keeps_preceding_slice_data_and_old_backup_reads(ec):
    from alembic.config import Config

    from alembic import command
    from tests.support.ec_env import ROOT

    run, item_id = saved_scene_item(ec)
    ec.rebuild_legacy_database(
        "el16_scene_feedback",
        preserve_tables=(
            "practice_sessions",
            "practice_items",
            "scene_attempts",
            "scene_feedback",
        ),
    )
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", ec.database_url)
    command.upgrade(config, "head")
    response = request_feedback(ec, run, item_id)
    assert response.status_code == 200, response.text
    backup = ec.client.get("/api/export/backup").json()
    assert backup["extensions"]["practice_sessions"][0]["feedback_epoch"]
    assert (
        backup["extensions"]["scene_attempts"][0]["answer"]
        == "Can I have water, please?"
    )
    # Earlier V3 has no local ownership token; restore must create a new one.
    del backup["extensions"]["practice_sessions"][0]["feedback_epoch"]
    from tests.test_el11_bounded_personalized_story import restore

    restore(ec, backup)
    assert request_feedback(ec, run, item_id).json() == response.json()
