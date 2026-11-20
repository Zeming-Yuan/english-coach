"""Selected expansion practice at the persisted HTTP session boundary."""

from uuid import uuid4


def _selection(ec):
    source = ec.seed_card(
        "apple",
        meaning="苹果",
        related_words=[{"kind": "lookalike", "word": "apply", "meaning": "申请"}],
    )
    revision = ec.client.get(f"/api/cards/{source}").json()["content_revision"]
    operation = str(uuid4())
    response = ec.client.post(
        f"/api/cards/{source}/expansion-additions",
        json={
            "operation_id": operation,
            "source_revision": revision,
            "target": {"word": "apply", "meaning": "申请"},
        },
    )
    assert response.is_success, response.text
    target = response.json()["card_id"]
    return {
        "id": str(uuid4()),
        "purpose": "expansion",
        "addition_operation_id": operation,
        "source_card_id": source,
        "source_revision": revision,
        "card_ids": [target],
        "targets": [
            {
                "card_id": target,
                "revision": ec.client.get(f"/api/cards/{target}").json()[
                    "content_revision"
                ],
            }
        ],
    }


def test_expansion_practice_has_context_and_new_session(ec):
    command = _selection(ec)
    first = ec.client.post("/api/practice-sessions", json=command)
    assert first.status_code == 200, first.text
    run = first.json()
    (item,) = run["items"]
    assert item["prompt"] == "I want to ___ for this job."
    assert set(item["options"]) == {"apply", "application"}
    assert "expected" not in item and "explanation" not in item
    replay = ec.client.post("/api/practice-sessions", json=command)
    assert replay.json()["id"] == run["id"]
    later = ec.client.post(
        "/api/practice-sessions", json={**command, "id": str(uuid4())}
    )
    assert later.json()["id"] != run["id"]


def _create(ec, command):
    response = ec.client.post("/api/practice-sessions", json=command)
    assert response.is_success, response.text
    return response.json()


def _attempt(ec, run, answer="apply", submission=None, target=None):
    (item,) = run["items"]
    return ec.client.post(
        f"/api/practice-sessions/{run['id']}/items/{item['id']}/attempts",
        json={
            "submission_id": submission or str(uuid4()),
            "answer": answer,
            "expansion_target_id": target if target is not None else item["card_id"],
        },
    )


def test_expansion_answer_replay_keeps_first_event_and_recognition(ec):
    command = _selection(ec)
    first = _create(ec, command)
    submission = str(uuid4())
    wrong = _attempt(ec, first, "application", submission)
    assert wrong.is_success, wrong.text
    result = wrong.json()
    assert result["committed"] and result["correct"] is False
    assert "动词" in result["session"]["items"][0]["explanation"]
    replay = _attempt(ec, first, "application", submission)
    assert replay.json()["event_id"] == result["event_id"]
    assert _attempt(ec, first, "apply", submission).status_code == 409
    assert _attempt(ec, first, "apply").status_code == 409

    second = _create(ec, {**command, "id": str(uuid4())})
    assert second["id"] != first["id"]
    right = _attempt(ec, second)
    assert right.is_success, right.text
    assert right.json()["correct"] is True
    assert "动词" in right.json()["session"]["items"][0]["explanation"]
    response = ec.client.get(f"/api/cards/{command['card_ids'][0]}").json()
    assert {event["correct"] for event in response["learning_events"]} == {True, False}
    assert len(response["learning_events"]) == 2
    assert all(
        event["kind"] == "choice" and not event["scheduled"]
        for event in response["learning_events"]
    )
    assert response["learning_evidence"]["retention"]["count"] == 0


def test_expansion_requires_confirmed_addition_and_matching_target(ec):
    command = _selection(ec)
    fake = {**command, "addition_operation_id": str(uuid4())}
    assert ec.client.post("/api/practice-sessions", json=fake).status_code == 404
    other = ec.seed_card("application", meaning="申请书")
    revision = ec.client.get(f"/api/cards/{other}").json()["content_revision"]
    wrong = {
        **command,
        "card_ids": [other],
        "targets": [{"card_id": other, "revision": revision}],
    }
    assert ec.client.post("/api/practice-sessions", json=wrong).status_code == 409
    assert (
        ec.client.post(
            "/api/practice-sessions", json={**command, "purpose": "targeted"}
        ).status_code
        == 422
    )
    assert (
        ec.client.post(
            "/api/practice-sessions", json={**command, "window": "day"}
        ).status_code
        == 422
    )
    _create(ec, command)
    assert ec.client.post("/api/practice-sessions", json=fake).status_code == 409


def test_expansion_assistance_is_not_independent_or_delayed(ec):
    command = _selection(ec)
    run = _create(ec, command)
    (item,) = run["items"]
    url = f"/api/practice-sessions/{run['id']}/items/{item['id']}/assistance"
    assert ec.client.post(url, json={"kind": "answer_audio"}).is_success
    assert _attempt(ec, run).is_success
    saved = ec.client.get(f"/api/cards/{item['card_id']}").json()
    (event,) = saved["learning_events"]
    assert event["kind"] == "choice" and event["assistance"] == ["answer_audio"]
    assert saved["learning_evidence"]["recall"]["count"] == 0
    assert saved["learning_evidence"]["retention"]["count"] == 0


def test_expansion_unavailable_for_unchecked_meaning_replays_safely(ec):
    custom = ec.seed_card("apply", meaning="运用")
    command = _selection(ec)
    assert command["card_ids"] == [custom]
    run = _create(ec, command)
    assert run["lifecycle"] == "unavailable"
    assert not run["items"]
    assert "暂无适合" in run["message"]
    assert _create(ec, command)["id"] == run["id"]
    assert ec.client.get(f"/api/cards/{custom}").json()["learning_events"] == []


def test_expansion_stale_source_cannot_submit_but_saved_history_survives(ec):
    command = _selection(ec)
    saved = _create(ec, command)
    submission = str(uuid4())
    first = _attempt(ec, saved, submission=submission).json()
    pending = _create(ec, {**command, "id": str(uuid4())})
    source = command["source_card_id"]
    assert ec.client.put(
        f"/api/cards/{source}", json={"meaning": "苹果公司"}
    ).is_success
    assert _attempt(ec, pending).status_code == 409
    assert (
        _attempt(ec, saved, submission=submission).json()["event_id"]
        == first["event_id"]
    )
    assert ec.client.delete(f"/api/cards/{source}").is_success
    history = ec.client.get(f"/api/practice-sessions/{saved['id']}").json()["items"][0]
    assert history["correct"] is True and history["stale"] is True
    assert _attempt(ec, pending).status_code == 409


def test_expansion_restore_preserves_history_and_fences_old_unsaved_target(ec):
    command = _selection(ec)
    finished = _create(ec, command)
    submission = str(uuid4())
    saved = _attempt(ec, finished, submission=submission).json()
    pending = _create(ec, {**command, "id": str(uuid4())})
    old_target = command["card_ids"][0]
    backup = ec.client.get("/api/export/backup").json()
    preview = ec.client.post("/api/import/preview", json=backup)
    assert preview.is_success, preview.text
    restored = ec.client.post(
        "/api/import/cards",
        json={
            "backup": backup,
            "expected_revision": preview.json()["expected_revision"],
        },
    )
    assert restored.is_success, restored.text
    current = ec.client.get(f"/api/practice-sessions/{pending['id']}").json()
    new_target = current["items"][0]["card_id"]
    assert new_target != old_target
    assert _attempt(ec, current, target=old_target).status_code == 409
    assert (
        _attempt(ec, finished, submission=submission).json()["event_id"]
        == saved["event_id"]
    )
    assert _attempt(ec, current).is_success
    assert len(ec.client.get(f"/api/cards/{new_target}").json()["learning_events"]) == 2


def test_expansion_backup_rejects_mismatched_receipt_and_material(ec):
    from copy import deepcopy

    _create(ec, _selection(ec))
    backup = ec.client.get("/api/export/backup").json()
    unrelated = deepcopy(backup)
    unrelated["extensions"]["practice_sessions"][0]["expansion_snapshot"][
        "addition_operation_id"
    ] = str(uuid4())
    assert ec.client.post("/api/import/preview", json=unrelated).status_code == 422
    wrong = deepcopy(backup)
    wrong["extensions"]["practice_items"][0]["question"]["expected"] = "application"
    assert ec.client.post("/api/import/preview", json=wrong).status_code == 422


def test_expansion_disabled_preserves_existing_create_and_answer_replay(ec):
    command = _selection(ec)
    run = _create(ec, command)
    submission = str(uuid4())
    saved = _attempt(ec, run, submission=submission)
    assert saved.is_success, saved.text
    ec.app.state.settings = ec.settings.model_copy(
        update={"expansion_practice_enabled": False}
    )
    assert (
        ec.client.post(
            "/api/practice-sessions", json={**command, "id": str(uuid4())}
        ).status_code
        == 403
    )
    assert _create(ec, command)["id"] == run["id"]
    assert (
        _attempt(ec, run, submission=submission).json()["event_id"]
        == saved.json()["event_id"]
    )


def test_expansion_target_edit_invalidates_old_question_and_delete_keeps_unavailable_run(
    ec,
):
    command = _selection(ec)
    run = _create(ec, command)
    target = command["card_ids"][0]
    assert ec.client.put(f"/api/cards/{target}", json={"meaning": "应用"}).is_success
    assert _attempt(ec, run).status_code == 409
    assert ec.client.delete(f"/api/cards/{target}").is_success
    historical = ec.client.get(f"/api/practice-sessions/{run['id']}").json()
    assert historical["lifecycle"] == "unavailable"
    assert historical["items"] == []
    backup = ec.client.get("/api/export/backup").json()
    assert ec.client.post("/api/import/preview", json=backup).is_success
