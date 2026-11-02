"""EL-11: bounded stories through public HTTP and deterministic quality rules."""

from uuid import uuid4


def test_el11_insufficient_vocabulary_is_explained(ec):
    response = ec.client.post(
        "/api/stories/generate",
        json={
            "operation_id": str(uuid4()),
            "include_new_target": False,
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["mode"] == "starter"
    assert data["quality"]["known_basis"] == "insufficient"
    assert ec.client.get("/api/cards").json()["cards"] == []


from copy import deepcopy
from unittest.mock import patch


def verified(ec, words=("apple",)):
    ids = [ec.seed_card(word=word) for word in words]
    for now in ("2026-10-01T01:00:00Z", "2026-10-02T02:00:00Z"):
        ec.set_time(now)
        for card_id, word in zip(ids, words):
            assert (
                ec.client.post(
                    "/api/typing/check",
                    json={
                        "card_id": card_id,
                        "user_input": word,
                        "source": "spelling",
                        "submission_id": str(uuid4()),
                    },
                ).status_code
                == 200
            )
    return ids


def valid_story():
    return {
        "title": "My apple",
        "title_cn": "我的苹果",
        "targets": ["apple"],
        "sentences": [
            {"en": "My apple is on the small table.", "cn": "我的苹果在小桌上。"},
            {"en": "I sit by the table and look at it.", "cn": "我坐在桌边看着它。"},
            {"en": "A book is near my cup of water.", "cn": "水杯旁有一本书。"},
            {"en": "I take the book and open it.", "cn": "我拿起书并打开。"},
            {
                "en": "Now I read by the table and smile.",
                "cn": "现在我在桌边读书，笑了。",
            },
            {"en": "This is a good day at home.", "cn": "这是在家里度过的美好一天。"},
        ],
        "check": {
            "question": "What is on the small table?",
            "question_cn": "小桌上有什么？",
            "options": ["apple", "book", "water"],
            "options_cn": ["苹果", "书", "水"],
            "expected": "apple",
            "evidence_index": 0,
        },
    }


def test_el11_verified_word_generates_version_and_replays_without_ai(ec):
    ids = verified(ec)
    operation = {"operation_id": str(uuid4()), "include_new_target": False}
    with patch(
        "app.services.story_generator.generate_json", return_value=valid_story()
    ):
        response = ec.client.post("/api/stories/generate", json=operation)
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["mode"] == "normal"
    assert data["quality"]["known_targets"] == ["apple"]
    assert data["quality"]["unknown_forms"] == []
    assert [word["id"] for word in data["words"]] == ids
    assert (
        data["check_material"]["evidence_sentence"]
        == valid_story()["sentences"][0]["en"]
    )
    assert data["version_id"]
    assert ec.client.post("/api/stories/generate", json=operation).json() == data
    assert len(ec.client.get("/api/stories").json()["stories"]) == 1
    snapshot = ec.snapshot()
    assert (
        snapshot["extensions"]["story_versions"][0]["operation_id"]
        == operation["operation_id"]
    )
    assert len(snapshot["learning_events"]) == 2


def test_el11_backup_rejects_forged_material_without_writes(ec):
    verified(ec)
    with patch(
        "app.services.story_generator.generate_json", return_value=valid_story()
    ):
        assert ec.client.post("/api/stories/generate").status_code == 200
    backup = ec.client.get("/api/export/backup").json()
    assert ec.client.post("/api/import/preview", json=backup).status_code == 200
    backup["extensions"]["story_versions"][0]["material"]["check"]["expected"] = "water"
    response = ec.client.post("/api/import/preview", json=backup)
    assert response.status_code == 422, response.text


import pytest


def _generate(ec, data=None, operation=None):
    with patch(
        "app.services.story_generator.generate_json", return_value=data or valid_story()
    ):
        return ec.client.post(
            "/api/stories/generate", json=operation or {"operation_id": str(uuid4())}
        )


def test_el11_commit_failure_retries_once_and_conflicting_consent_is_rejected(ec):
    verified(ec)
    operation = {"operation_id": str(uuid4()), "include_new_target": False}
    before = ec.snapshot()
    ec.fail_commit_once()
    assert _generate(ec, operation=operation).status_code == 500
    assert ec.snapshot() == before
    assert _generate(ec, operation=operation).status_code == 200
    after = ec.snapshot()
    assert ec.client.post("/api/stories/generate", json=operation).status_code == 200
    assert ec.snapshot() == after
    assert (
        ec.client.post(
            "/api/stories/generate", json={**operation, "include_new_target": True}
        ).status_code
        == 409
    )


@pytest.mark.parametrize(
    "defect",
    [
        "length",
        "sentence",
        "translation",
        "target",
        "unknown",
        "question",
        "title_sentence",
        "question_sentence",
        "option_sentence",
        "structure",
    ],
)
def test_el11_invalid_material_never_publishes_after_one_correction(ec, defect):
    verified(ec)
    assert _generate(ec).status_code == 200
    before = ec.snapshot()
    data = valid_story()
    if defect == "length":
        data["sentences"] = data["sentences"][:1]
    elif defect == "sentence":
        data["sentences"][0]["en"] = (
            "My apple is on the small table and I look at the small table by me."
        )
    elif defect == "translation":
        data["sentences"][0]["cn"] = "   "
    elif defect == "target":
        data["targets"] = ["pear"]
    elif defect == "unknown":
        data["title"] = "Bright apples dance"
    elif defect == "question":
        data["check"]["options"] = ["apple", "table", "water"]
    elif defect == "title_sentence":
        data["title"] = " ".join(["book"] * 13)
    elif defect == "question_sentence":
        data["check"]["question"] = " ".join(["book"] * 13)
    elif defect == "option_sentence":
        data["check"]["options"][1] = " ".join(["book"] * 13)
    else:
        data["sentences"] = None
    with patch(
        "app.services.story_generator.generate_json", return_value=data
    ) as external:
        response = ec.client.post("/api/stories/generate")
    assert response.status_code == 422
    assert external.call_count == 2
    assert ec.snapshot() == before


@pytest.mark.parametrize(
    "mode", ["unrecorded", "self_rating", "assisted", "weak", "stale", "revised"]
)
def test_el11_only_current_verified_recall_is_known(ec, mode):
    if mode in ("weak", "stale", "revised"):
        [card_id] = verified(ec)
    else:
        card_id = ec.seed_card()
    if mode == "self_rating":
        assert (
            ec.client.post(
                "/api/reviews", json={"card_id": card_id, "rating": 4}
            ).status_code
            == 200
        )
    elif mode in ("assisted", "weak"):
        ec.set_time("2026-10-03T03:00:00Z")
        assert (
            ec.client.post(
                "/api/typing/check",
                json={
                    "card_id": card_id,
                    "user_input": "wrong" if mode == "weak" else "apple",
                    "source": "spelling",
                    "assistance": ["first_letter"] if mode == "assisted" else [],
                    "submission_id": str(uuid4()),
                },
            ).status_code
            == 200
        )
    elif mode == "stale":
        ec.set_time("2026-11-05T03:00:00Z")
    elif mode == "revised":
        assert (
            ec.client.put(
                f"/api/cards/{card_id}", json={"meaning": "新释义"}
            ).status_code
            == 200
        )
    response = ec.client.post("/api/stories/generate")
    assert response.status_code == 200
    assert response.json()["mode"] == "starter"
    assert response.json()["quality"]["known_targets"] == []


def test_el11_one_correction_can_publish_and_unknown_forms_are_explicit(ec):
    verified(ec)
    data = valid_story()
    data["title"] = "Apple's day"
    data["sentences"][0]["en"] = "My apple is on the small table by apples."
    with patch("app.services.story_generator.generate_json", side_effect=[{}, data]):
        response = ec.client.post("/api/stories/generate")
    assert response.status_code == 200, response.text
    assert response.json()["quality"]["unknown_forms"] == ["apple's", "apples"]
    assert len(ec.client.get("/api/cards").json()["cards"]) == 1


def test_el11_explicit_consent_allows_only_one_unverified_target(ec):
    verified(ec)
    ec.seed_card(word="pear", meaning="梨")
    data = valid_story()
    data["targets"] = ["apple", "pear"]
    data["sentences"][1] = {
        "en": "I see a pear near it.",
        "cn": "我看到它旁边有一个梨。",
    }
    denied = _generate(ec, data)
    assert denied.status_code == 422
    saved = _generate(ec, data, {"include_new_target": True})
    assert saved.status_code == 200, saved.text
    assert saved.json()["quality"]["new_targets"] == ["pear"]
    assert len(ec.client.get("/api/cards").json()["cards"]) == 2


def restore(target, backup):
    preview = target.client.post("/api/import/preview", json=backup)
    assert preview.status_code == 200, preview.text
    response = target.client.post(
        "/api/import/cards",
        json={
            "backup": backup,
            "expected_revision": preview.json()["expected_revision"],
        },
    )
    assert response.status_code == 200, response.text


def test_el11_v3_restores_versions_targets_operations_and_deletion_tombstone(
    ec, ec_factory
):
    verified(ec)
    operation = {"operation_id": str(uuid4())}
    data = _generate(ec, operation=operation).json()
    backup = ec.client.get("/api/export/backup").json()
    target = ec_factory()
    target.seed_card(word="retired")
    restore(target, backup)
    replay = target.client.post("/api/stories/generate", json=operation)
    assert replay.status_code == 200, replay.text
    after = replay.json()
    assert (
        after["id"] != data["id"] or after["words"][0]["id"] != data["words"][0]["id"]
    )
    assert after["version_id"] == data["version_id"]
    assert after["check_material"] == data["check_material"]
    assert after["content_revision"] == data["content_revision"]
    assert target.client.delete(f"/api/stories/{after['id']}").status_code == 200
    assert (
        target.client.post("/api/stories/generate", json=operation).status_code == 410
    )
    assert target.client.get(f"/api/cards/{after['words'][0]['id']}").status_code == 200
    restore(ec, target.client.get("/api/export/backup").json())
    assert ec.client.post("/api/stories/generate", json=operation).status_code == 410


@pytest.mark.parametrize("failure", ["missing", "timeout"])
def test_el11_external_failure_keeps_previous_story(ec, failure):
    from app.services.llm_client import LLMNotConfigured

    verified(ec)
    assert _generate(ec).status_code == 200
    before = ec.snapshot()
    with patch(
        "app.services.story_generator.generate_json",
        side_effect=LLMNotConfigured("AI未配置") if failure == "missing" else None,
        return_value=None,
    ):
        result = ec.client.post("/api/stories/generate")
    assert result.status_code == (503 if failure == "missing" else 502)
    assert ec.snapshot() == before


@pytest.mark.parametrize("change", ["revision", "delete", "restore", "evidence"])
def test_el11_late_generation_cannot_publish_changed_context(ec, change):
    [card_id] = verified(ec)
    before_backup = ec.client.get("/api/export/backup").json()

    def external(*args, **kwargs):
        if change == "revision":
            assert (
                ec.client.put(
                    f"/api/cards/{card_id}", json={"meaning": "另一个释义"}
                ).status_code
                == 200
            )
        elif change == "delete":
            assert ec.client.delete(f"/api/cards/{card_id}").status_code == 200
        elif change == "restore":
            restore(ec, before_backup)
        else:
            ec.set_time("2026-10-03T03:00:00Z")
            assert (
                ec.client.post(
                    "/api/typing/check",
                    json={
                        "card_id": card_id,
                        "user_input": "wrong",
                        "source": "spelling",
                        "submission_id": str(uuid4()),
                    },
                ).status_code
                == 200
            )
        return valid_story()

    with patch("app.services.story_generator.generate_json", side_effect=external):
        response = ec.client.post("/api/stories/generate")
    assert response.status_code == 409, response.text
    assert ec.client.get("/api/stories").json()["stories"] == []


def test_el11_concurrent_duplicate_operation_saves_one_version(ec):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    verified(ec)
    operation = {"operation_id": str(uuid4())}
    barrier = Barrier(2)

    def external(*args):
        barrier.wait(timeout=10)
        return valid_story()

    with (
        patch("app.services.story_generator.generate_json", side_effect=external),
        ThreadPoolExecutor(max_workers=2) as workers,
    ):
        results = list(
            workers.map(
                lambda _: ec.client.post("/api/stories/generate", json=operation),
                range(2),
            )
        )
    assert [r.status_code for r in results] == [200, 200]
    assert results[0].json() == results[1].json()
    assert len(ec.snapshot()["extensions"]["story_versions"]) == 1


def test_el11_functional_rollback_keeps_versions_and_backup(ec):
    verified(ec)
    data = _generate(ec).json()
    before = ec.snapshot()
    ec.settings.bounded_stories_enabled = False
    assert ec.client.get("/api/stories").json()["generation_enabled"] is False
    assert ec.client.post("/api/stories/generate").status_code == 403
    assert (
        ec.client.get(f"/api/stories/{data['id']}").json()["version_id"]
        == data["version_id"]
    )
    assert ec.snapshot() == before


def test_el11_support_and_starter_are_checked_and_not_personal_mastery():
    from app.services.story_quality import STARTER, SUPPORT, validate_story

    data = deepcopy(STARTER)
    data["targets"] = ["book"]
    assert validate_story(data, set(), set(SUPPORT["words"]), "normal") == []


@pytest.mark.parametrize("count", [1, 3, 4])
def test_el11_selects_one_to_three_known_targets(ec, count):
    words = ("apple", "pear", "cat", "dog")[:count]
    verified(ec, words)
    data = valid_story()
    data["targets"] = list(words[:3])
    data["sentences"][1]["en"] = (
        "I see " + " and ".join(words[1:3]) + " near it."
        if count > 1
        else data["sentences"][1]["en"]
    )
    response = _generate(ec, data)
    assert response.status_code == 200, response.text
    assert response.json()["quality"]["known_targets"] == list(words[:3])


def test_el11_coverage_basis_is_rechecked_beyond_target_words(ec):
    ids = verified(ec, ("apple", "pear", "cat", "dog"))
    data = valid_story()
    data["targets"] = ["apple", "pear", "cat"]
    data["sentences"][1] = {
        "en": "A pear and a cat are near it.",
        "cn": "一个梨和一只猫在旁边。",
    }
    data["sentences"][-1] = {
        "en": "This is a good day at home with my dog.",
        "cn": "这是和我的狗在家度过的美好一天。",
    }

    def external(*args):
        ec.set_time("2026-10-03T03:00:00Z")
        assert (
            ec.client.post(
                "/api/typing/check",
                json={
                    "card_id": ids[-1],
                    "user_input": "wrong",
                    "source": "spelling",
                    "submission_id": str(uuid4()),
                },
            ).status_code
            == 200
        )
        return data

    with patch("app.services.story_generator.generate_json", side_effect=external):
        response = ec.client.post("/api/stories/generate")
    assert response.status_code == 409


def test_el11_manual_starter_does_not_claim_personal_evidence_is_insufficient(ec):
    verified(ec)
    starter = ec.client.get("/api/stories/starter").json()
    assert starter["quality"]["known_basis"] == "starter_material"


def test_el11_duplicate_verified_word_cards_do_not_duplicate_targets(ec):
    verified(ec, ("apple", "apple"))
    result = _generate(ec)
    assert result.status_code == 200, result.text
    assert result.json()["quality"]["known_targets"] == ["apple"]


def test_el11_consent_does_not_mistake_duplicate_known_card_for_new_word(ec):
    verified(ec, ("apple", "apple"))
    ec.seed_card(word="pear", meaning="梨")
    data = valid_story()
    data["targets"] = ["apple", "pear"]
    data["sentences"][1] = {
        "en": "I see a pear near it.",
        "cn": "我看到它旁边有一个梨。",
    }
    result = _generate(ec, data, {"include_new_target": True})
    assert result.status_code == 200, result.text
    assert result.json()["quality"]["new_targets"] == ["pear"]
