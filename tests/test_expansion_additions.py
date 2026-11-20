"""Confirmed expansion operations through the real HTTP and restore boundaries."""

from uuid import uuid4


def test_addition_replays_one_card(ec):
    source = ec.seed_card(
        "apple",
        meaning="苹果",
        related_words=[{"kind": "lookalike", "word": "apply", "meaning": "申请"}],
    )
    path = f"/api/cards/{source}"
    revision = ec.client.get(path).json()["content_revision"]
    command = {
        "operation_id": str(uuid4()),
        "source_revision": revision,
        "target": {"word": "apply", "meaning": "申请"},
    }
    first = ec.client.post(path + "/expansion-additions", json=command)
    assert first.status_code == 200, first.text
    replay = ec.client.post(path + "/expansion-additions", json=command)
    assert replay.status_code == 200, replay.text
    assert first.json() == replay.json()
    assert first.json()["committed"] is True
    cards = ec.client.get("/api/cards").json()["cards"]
    copies = [
        card for card in cards if card["word"] == "apply" and card["kind"] == "word"
    ]
    assert [card["id"] for card in copies] == [first.json()["card_id"]]


def _command(ec, source, word="apply", meaning="申请"):
    path = f"/api/cards/{source}"
    data = {
        "operation_id": str(uuid4()),
        "source_revision": ec.client.get(path).json()["content_revision"],
        "target": {"word": word, "meaning": meaning},
    }
    return path + "/expansion-additions", data


def _restore(client, backup):
    preview = client.post("/api/import/preview", json=backup)
    assert preview.is_success, preview.text
    response = client.post(
        "/api/import/cards",
        json={
            "backup": backup,
            "expected_revision": preview.json()["expected_revision"],
        },
    )
    assert response.is_success, response.text
    return preview.json()


def _apple(ec):
    return ec.seed_card(
        "apple",
        meaning="苹果",
        related_words=[
            {"kind": "lookalike", "word": "apply", "meaning": "申请"},
            {"kind": "compound", "word": "apple juice", "meaning": "苹果汁"},
        ],
    )


def test_existing_card_history_and_kind_are_preserved(ec):
    source = _apple(ec)
    target = ec.seed_card(" Apply ", meaning="我的释义", example="My own example.")
    sentence = ec.seed_card("apply", kind="sentence", meaning="单句")
    saved = ec.client.post(
        "/api/reviews",
        json={"card_id": target, "rating": 3, "submission_id": str(uuid4())},
    )
    assert saved.is_success, saved.text
    url, command = _command(ec, source, "  APPLY  ")
    addition = ec.client.post(url, json=command)
    assert addition.is_success, addition.text
    assert addition.json()["card_id"] == target
    assert not addition.json()["created"]
    conflict = {**command, "target": {"word": "apple juice", "meaning": "苹果汁"}}
    assert ec.client.post(url, json=conflict).status_code == 409
    card = ec.client.get(f"/api/cards/{target}").json()
    assert (card["word"], card["meaning"], card["example"]) == (
        " Apply ",
        "我的释义",
        "My own example.",
    )
    assert len(card["learning_events"]) == 1
    assert ec.client.get(f"/api/cards/{sentence}").json()["kind"] == "sentence"


def test_concurrent_additions_make_one_word_even_with_homograph_sentence(ec):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    source = _apple(ec)
    sentence = ec.seed_card("apply", kind="sentence")
    url, first = _command(ec, source)
    second = {**first, "operation_id": str(uuid4())}
    start = Barrier(2, timeout=5)

    def send(command):
        start.wait()
        return ec.client.post(url, json=command)

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(send, [first, second]))
    assert all(response.is_success for response in responses)
    results = [response.json() for response in responses]
    target = results[0]["card_id"]
    assert target != sentence
    assert [row["card_id"] for row in results] == [target, target]
    assert sum(result["created"] for result in results) == 1
    assert (
        len(
            ec.client.get(f"/api/expansion-additions?target_card_id={target}").json()[
                "additions"
            ]
        )
        == 2
    )


def test_addition_requires_current_source_and_displayed_target(ec):
    source = _apple(ec)
    url, command = _command(ec, source)
    fabricated = {**command, "target": {"word": "apply", "meaning": "苹果"}}
    assert ec.client.post(url, json=fabricated).status_code == 409
    assert ec.client.put(
        f"/api/cards/{source}", json={"meaning": "苹果公司"}
    ).is_success
    assert ec.client.post(url, json=command).status_code == 409
    assert ec.client.delete(f"/api/cards/{source}").is_success
    assert ec.client.post(url, json=command).status_code == 404
    assert ec.client.get("/api/cards").json()["cards"] == []


def test_failed_commit_does_not_leave_a_card_or_receipt(ec):
    url, command = _command(ec, _apple(ec))
    ec.fail_commit_once()
    assert ec.client.post(url, json=command).status_code == 500
    assert (
        ec.client.get(f"/api/expansion-additions/{command['operation_id']}").status_code
        == 404
    )
    cards = ec.client.get("/api/cards").json()["cards"]
    assert [card["word"] for card in cards] == ["apple"]
    result = ec.client.post(url, json=command)
    assert result.is_success, result.text
    assert result.json()["created"]


def test_restore_maps_added_phrase_and_replays_only_committed_requests(ec):
    source = _apple(ec)
    url, command = _command(ec, source, "apple juice", "苹果汁")
    old_pending = {**command, "operation_id": str(uuid4())}
    original = ec.client.post(url, json=command)
    assert original.is_success, original.text
    target = original.json()["card_id"]
    assert ec.client.post(
        "/api/reviews",
        json={"card_id": target, "rating": 3, "submission_id": str(uuid4())},
    ).is_success
    backup = ec.client.get("/api/export/backup").json()
    assert len(backup["extensions"]["expansion_additions"]) == 1
    _restore(ec.client, backup)

    receipt_url = f"/api/expansion-additions/{command['operation_id']}"
    receipt = ec.client.get(receipt_url).json()
    assert receipt["source_card_id"] != source
    restored = receipt["target_card_id"]
    assert restored != target
    assert ec.client.post(url, json=command).json()["card_id"] == restored
    assert ec.client.post(url, json=old_pending).status_code == 404
    card = ec.client.get(f"/api/cards/{restored}").json()
    assert card["word"] == "apple juice"
    assert len(card["learning_events"]) == 1

    assert ec.client.delete(f"/api/cards/{receipt['source_card_id']}").is_success
    assert ec.client.post(url, json=command).json()["card_id"] == restored
    assert ec.client.delete(f"/api/cards/{restored}").is_success
    replay = ec.client.post(url, json=command).json()
    assert replay["committed"] and not replay["available"] and replay["card_id"] is None
    assert ec.client.get("/api/cards").json()["cards"] == []


def test_backup_rejects_orphan_receipt_and_supports_early_v3(ec, ec_factory):
    from copy import deepcopy

    url, command = _command(ec, _apple(ec))
    assert ec.client.post(url, json=command).is_success
    backup = ec.client.get("/api/export/backup").json()
    invalid = deepcopy(backup)
    invalid["extensions"]["expansion_additions"][0]["target_card_id"] = 9000
    other = ec_factory().client
    assert other.post("/api/import/preview", json=invalid).status_code == 422
    backup["features"].remove("expansion_additions")
    del backup["extensions"]["expansion_additions"]
    preview = _restore(other, backup)
    assert "expansion_additions" in preview["extensions"]["missing"]
    assert (
        other.get(f"/api/expansion-additions/{command['operation_id']}").status_code
        == 404
    )


def test_disabling_writes_preserves_read_and_replay(ec):
    url, command = _command(ec, _apple(ec))
    first = ec.client.post(url, json=command)
    assert first.is_success, first.text
    ec.app.state.settings = ec.settings.model_copy(
        update={"expansion_additions_enabled": False}
    )
    fresh = {**command, "operation_id": str(uuid4())}
    assert ec.client.post(url, json=fresh).status_code == 403
    assert ec.client.post(url, json=command).json() == first.json()
    assert ec.client.get(
        f"/api/expansion-additions/{command['operation_id']}"
    ).is_success
    assert ec.client.get("/api/expansion-additions").json() == {
        "enabled": False,
        "additions": [],
    }
