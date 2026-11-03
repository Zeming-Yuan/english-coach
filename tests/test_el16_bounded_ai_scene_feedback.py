"""EL-16: saved scene answers receive bounded, recoverable feedback."""

from uuid import uuid4


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
