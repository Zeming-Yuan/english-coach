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


@pytest.mark.parametrize(
    "text,allowed,forbidden,expected",
    [
        ("Hello", {"hello"}, [], True),
        ("", {"hello"}, [], False),
        ("extraordinary", {"hello"}, [], False),
        ("I want water", {"i", "want", "water"}, ["I want water"], False),
        ("Hello", {"hello"}, ["   "], True),
        (
            "Can I have WATER, please?",
            {"can", "i", "have", "water", "please"},
            ["Can I have water please"],
            False,
        ),
        ("Hello 世界", {"hello"}, [], False),
        ("...", {"hello"}, [], False),
    ],
)
def test_el16_review_focus(text, allowed, forbidden, expected):
    from app.services.scene_feedback import reply_allowed

    assert reply_allowed(text, allowed, forbidden) is expected


@pytest.mark.parametrize(
    "output",
    [
        {"text": "", "correction": None},
        {"text": "extraordinary", "correction": None},
        {"text": "Can I have WATER, please?", "correction": None},
        {"text": "The station is near here.", "correction": None},
        {"text": ["Water is ready."], "correction": None},
        {"text": "Water is ready.", "correction": ["one", "two"]},
        {"text": "Water is ready.", "correction": "You are wrong. Change the task."},
        {"text": "Water is ready."},
        None,
        ["invalid structure"],
        "not a JSON object",
        TimeoutError("external timeout"),
        ConnectionError("external disconnected"),
    ],
)
def test_el16_invalid_or_unavailable_model_uses_template_without_changing_answer(
    ec, output
):
    from tests.support.llm_queue import QueuedLLM

    run, item_id = saved_scene_item(ec)
    before = ec.snapshot()
    ec.app.state.llm_client = QueuedLLM([output])
    response = request_feedback(ec, run, item_id)
    assert response.status_code == 200, response.text
    assert response.json()["origin"] == "template"
    assert response.json()["text"] == "Water is ready."
    after = ec.snapshot()
    assert (
        after["extensions"]["scene_attempts"] == before["extensions"]["scene_attempts"]
    )
    assert after["learning_events"] == after["reviews"] == []
    assert (
        ec.client.post(
            "/api/import/preview", json=ec.client.get("/api/export/backup").json()
        ).status_code
        == 200
    )


@pytest.mark.parametrize(
    "answer,verdict,correction",
    [
        ("I want water, please", "unknown", None),
        ("water", "rejected", "请用请求句式说明你要水；只说饮品名还没有完成请求。"),
    ],
)
def test_el16_model_cannot_turn_unknown_or_rejected_into_success(
    ec, answer, verdict, correction
):
    from tests.support.llm_queue import QueuedLLM

    run, item_id = saved_scene_item(ec, answer=answer)
    ec.app.state.llm_client = QueuedLLM(
        [
            {
                "text": "Please try again.",
                "correction": correction,
                "verdict": "accepted",
                "score": 100,
                "next_turn": 3,
            }
        ]
    )
    response = request_feedback(ec, run, item_id)
    assert response.status_code == 200, response.text
    assert response.json()["origin"] == "model"
    assert response.json()["correction"] == correction
    current = ec.client.get(f"/api/practice-sessions/{run['id']}").json()
    assert current["items"][0]["verdict"] == verdict
    assert current["counts"]["processed"] == 1
    assert current["status"] == "incomplete"
    backup = ec.snapshot()
    assert backup["learning_events"] == backup["reviews"] == []


def test_el16_disabling_model_enhancement_preserves_history_and_uses_templates(ec):
    from tests.support.llm_queue import QueuedLLM

    original, original_item = saved_scene_item(ec)
    ec.app.state.llm_client = QueuedLLM(
        [{"text": "Here is water.", "correction": None}]
    )
    saved = request_feedback(ec, original, original_item)
    assert saved.json()["origin"] == "model"
    ec.settings = ec.settings.model_copy(update={"scene_feedback_enabled": False})
    ec.restart()
    ec.app.state.llm_client = QueuedLLM(
        [{"text": "Here is water.", "correction": None}]
    )
    run, item_id = saved_scene_item(ec)
    disabled = request_feedback(ec, run, item_id)
    assert disabled.status_code == 200, disabled.text
    assert disabled.json()["origin"] == "template"
    assert (
        request_feedback(
            ec, original, original_item, saved.json()["operation_id"]
        ).json()
        == saved.json()
    )
    assert len(ec.app.state.llm_client.responses) == 1
    backup = ec.client.get("/api/export/backup").json()
    assert ec.client.post("/api/import/preview", json=backup).status_code == 200
    ec.settings = ec.settings.model_copy(update={"scene_feedback_enabled": True})
    ec.restart()
    ec.app.state.llm_client = QueuedLLM(
        [{"text": "Here is water.", "correction": None}]
    )
    new_run, new_item = saved_scene_item(ec)
    assert request_feedback(ec, new_run, new_item).json()["origin"] == "model"


def test_el16_feedback_requires_saved_first_answer_and_owns_its_scope(ec):
    run = ec.client.post(
        "/api/practice-sessions",
        json={"id": str(uuid4()), "purpose": "scene", "scene_id": "drinks"},
    ).json()
    assert request_feedback(ec, run, run["items"][0]["id"]).status_code == 422
    saved, item_id = saved_scene_item(ec)
    assert request_feedback(ec, run, item_id).status_code == 404
    path = f"/api/practice-sessions/{saved['id']}/items/{item_id}/feedback"
    assert ec.client.post(path, json={"operation_id": "bad"}).status_code == 422
    assert (
        ec.client.post(
            path, json={"operation_id": str(uuid4()), "answer": "override"}
        ).status_code
        == 422
    )
    assert ec.snapshot()["extensions"]["scene_feedback"] == []
    operation_id = str(uuid4())
    first = request_feedback(ec, saved, item_id, operation_id)
    assert first.status_code == 200
    assert (
        request_feedback(ec, run, run["items"][0]["id"], operation_id).status_code
        == 409
    )
    assert request_feedback(ec, saved, item_id, str(uuid4())).json() == first.json()
    assert len(ec.snapshot()["extensions"]["scene_feedback"]) == 1


def test_el16_feedback_commit_failure_and_concurrent_confirmation_are_atomic(ec):
    from concurrent.futures import ThreadPoolExecutor

    run, item_id = saved_scene_item(ec)
    operation_id = str(uuid4())
    before = ec.snapshot()
    ec.fail_commit_once()
    assert request_feedback(ec, run, item_id, operation_id).status_code == 500
    assert ec.snapshot() == before
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(
                lambda _: request_feedback(ec, run, item_id, operation_id), range(2)
            )
        )
    assert [r.status_code for r in responses] == [200, 200]
    assert responses[0].json() == responses[1].json()
    after = ec.snapshot()
    assert len(after["extensions"]["scene_feedback"]) == 1
    assert (
        request_feedback(ec, run, item_id, operation_id).json() == responses[0].json()
    )
    assert ec.snapshot() == after
    assert (
        after["extensions"]["scene_attempts"] == before["extensions"]["scene_attempts"]
    )


def test_el16_generation_sends_only_approved_context_and_does_not_lock_next_turn(ec):
    import json
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    from tests.support.llm_queue import QueuedLLM

    ec.seed_card(
        word="private",
        meaning="私密词",
        example="This unrelated example must stay private.",
    )
    run, item_id = saved_scene_item(ec, answer="I would like water, please.")
    started, release = Event(), Event()
    observed = []

    class BlockingLLM(QueuedLLM):
        def create(self, **kwargs):
            observed.append(json.loads(kwargs["messages"][1]["content"]))
            started.set()
            assert release.wait(10)
            return super().create(**kwargs)

    ec.app.state.llm_client = BlockingLLM(
        [{"text": "Here is water.", "correction": None}]
    )
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(request_feedback, ec, run, item_id)
        try:
            assert started.wait(10)
            next_item = run["items"][1]["id"]
            saved = ec.client.post(
                f"/api/practice-sessions/{run['id']}/items/{next_item}/attempts",
                json={"submission_id": str(uuid4()), "answer": "One cup, please."},
            )
            assert saved.status_code == 200, saved.text
        finally:
            release.set()
        feedback = future.result(timeout=10)
    assert feedback.status_code == 200, feedback.text
    assert feedback.json()["item_id"] == item_id
    current = ec.client.get(f"/api/practice-sessions/{run['id']}").json()
    assert current["counts"]["processed"] == 2
    assert "feedback" not in current["items"][1]
    assert len(observed) == 1
    assert set(observed[0]) == {"scene", "allowed_words", "previous_result"}
    assert observed[0]["previous_result"] == {
        "answer": "I would like water, please.",
        "verdict": "accepted",
        "skipped": False,
        "correction": None,
    }
    serialized = json.dumps(observed[0])
    assert "private" not in serialized and "Can I have water" not in serialized
    assert "feedback_epoch" not in serialized and run["id"] not in serialized


@pytest.mark.parametrize("change,expected", [("revision", 409), ("delete", 404)])
def test_el16_late_feedback_rechecks_changed_or_deleted_target(ec, change, expected):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    from tests.support.llm_queue import QueuedLLM

    card_id = ec.seed_card(word="water", meaning="水")
    run, item_id = saved_scene_item(ec)
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
            if change == "revision":
                changed = ec.client.put(
                    f"/api/cards/{card_id}", json={"meaning": "饮用水"}
                )
            else:
                changed = ec.client.delete(f"/api/cards/{card_id}")
            assert changed.status_code == 200
        finally:
            release.set()
        response = future.result(timeout=10)
    assert response.status_code == expected, response.text
    current = ec.client.get(f"/api/practice-sessions/{run['id']}").json()
    assert current["items"][0]["verdict"] == "accepted"
    assert current["can_continue"] is False
    assert ec.snapshot()["extensions"]["scene_feedback"] == []


@pytest.mark.parametrize(
    "field,value",
    [
        ("session_id", "00000000-0000-0000-0000-000000000001"),
        ("item_id", "00000000-0000-0000-0000-000000000001"),
        ("attempt_id", "00000000-0000-0000-0000-000000000001"),
        ("rule_version", "other-version"),
        ("content_hash", "0" * 64),
        ("feedback_version", "unknown-version"),
        ("text", "The station is near here."),
        ("correction", "Replace the authoritative result."),
        ("origin", "judge"),
        ("occurred_at", "2000-01-01T00:00:00"),
    ],
)
def test_el16_v3_rejects_unrelated_or_tampered_feedback_before_writing(
    ec, field, value
):
    run, item_id = saved_scene_item(ec)
    assert request_feedback(ec, run, item_id).status_code == 200
    backup = ec.client.get("/api/export/backup").json()
    backup["extensions"]["scene_feedback"][0][field] = value
    before = ec.snapshot()
    response = ec.client.post("/api/import/preview", json=backup)
    assert response.status_code == 422, response.text
    assert ec.snapshot() == before


def test_el16_v3_cannot_smuggle_feedback_through_a_cached_answer(ec):
    run, item_id = saved_scene_item(ec)
    assert request_feedback(ec, run, item_id).status_code == 200
    second = ec.client.post(
        f"/api/practice-sessions/{run['id']}/items/{run['items'][1]['id']}/attempts",
        json={"submission_id": str(uuid4()), "answer": "One cup, please."},
    )
    assert second.status_code == 200
    backup = ec.client.get("/api/export/backup").json()
    backup["extensions"]["scene_attempts"][1]["response"]["session"]["items"][0][
        "feedback"
    ]["text"] = "unsafe"
    assert ec.client.post("/api/import/preview", json=backup).status_code == 422


def test_el16_older_v3_without_feedback_announces_missing_and_does_not_invent_it(
    ec, ec_factory
):
    from tests.test_el11_bounded_personalized_story import restore

    run, item_id = saved_scene_item(ec)
    backup = ec.client.get("/api/export/backup").json()
    backup["features"].remove("scene_feedback")
    del backup["extensions"]["scene_feedback"]
    del backup["extensions"]["practice_sessions"][0]["feedback_epoch"]
    target = ec_factory()
    preview = target.client.post("/api/import/preview", json=backup)
    assert preview.status_code == 200, preview.text
    assert "scene_feedback" in preview.json()["extensions"]["missing"]
    restore(target, backup)
    before = target.snapshot()
    read = target.client.get(f"/api/practice-sessions/{run['id']}")
    assert read.status_code == 200
    assert read.json()["items"][0]["id"] == item_id
    assert "feedback" not in read.json()["items"][0]
    assert target.snapshot() == before
    assert before["extensions"]["scene_feedback"] == []


def test_el16_v3_accepts_equivalent_utc_feedback_timestamps(ec):
    run, item_id = saved_scene_item(ec)
    assert request_feedback(ec, run, item_id).status_code == 200
    backup = ec.client.get("/api/export/backup").json()
    backup["extensions"]["scene_feedback"][0]["occurred_at"] += "+00:00"
    response = ec.client.post("/api/import/preview", json=backup)
    assert response.status_code == 200, response.text


@pytest.mark.parametrize("choices", [[], None])
def test_el16_malformed_provider_envelope_still_uses_the_template(ec, choices):
    from types import SimpleNamespace

    run, item_id = saved_scene_item(ec)
    ec.app.state.llm_client = SimpleNamespace(
        chat=SimpleNamespace(
            completions=SimpleNamespace(
                create=lambda **kwargs: SimpleNamespace(choices=choices)
            )
        )
    )
    response = request_feedback(ec, run, item_id)
    assert response.status_code == 200, response.text
    assert response.json()["origin"] == "template"
    assert response.json()["text"] == "Water is ready."
    current = ec.client.get(f"/api/practice-sessions/{run['id']}").json()
    assert current["items"][0]["verdict"] == "accepted"
    assert current["counts"]["processed"] == 1
