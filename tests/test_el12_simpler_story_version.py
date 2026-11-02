"""EL-12: independent simpler stories at public rules and HTTP seams."""

from app.services.story_quality import story_profile


def test_el12_short_profile_is_not_normal_profile():
    assert story_profile("short") == {
        "min_words": 20,
        "max_words": 40,
        "max_sentence": 8,
        "max_unknown": 2,
    }


from uuid import uuid4

from tests.support.llm_queue import QueuedLLM
from tests.test_el11_bounded_personalized_story import _generate, restore, verified


def short_story():
    return {
        "title": "My apple",
        "title_cn": "我的苹果",
        "targets": ["apple"],
        "sentences": [
            {"en": "My apple is on the small table.", "cn": "我的苹果在小桌上。"},
            {"en": "I sit by it and smile.", "cn": "我坐在旁边笑了。"},
            {"en": "My book is near my cup.", "cn": "我的书在杯子旁。"},
            {"en": "I take it and read.", "cn": "我拿起书来读。"},
        ],
        "check": {
            "question": "What is on the table?",
            "question_cn": "桌上有什么？",
            "options": ["apple", "book", "water"],
            "options_cn": ["苹果", "书", "水"],
            "expected": "apple",
            "evidence_index": 0,
        },
    }


def prepare(ec):
    verified(ec)
    original = _generate(ec).json()
    ec.app.state.llm_client = QueuedLLM([short_story(), short_story()])
    return original, {
        "operation_id": str(uuid4()),
        "version_id": original["version_id"],
    }


def test_el12_simplify_keeps_original_and_independent_material_and_replay(ec):
    original, operation = prepare(ec)
    path = f"/api/stories/{original['id']}/simplify"
    response = ec.client.post(path, json=operation)
    assert response.status_code == 200, response.text
    short = response.json()
    assert short["mode"] == "short"
    assert short["id"] != original["id"]
    assert short["version_id"] != original["version_id"]
    assert short["parent_version_id"] == original["version_id"]
    assert short["content"] == "\n".join(r["en"] for r in short_story()["sentences"])
    assert short["check_status"] == "unchecked"
    assert (
        ec.client.get(f"/api/stories/{original['id']}").json()["content"]
        == original["content"]
    )
    after = ec.snapshot()
    assert ec.client.post(path, json=operation).json() == short
    assert ec.snapshot() == after
    assert len(after["extensions"]["story_versions"]) == 2
    assert len(after["learning_events"]) == 2


def test_el12_v3_restores_version_graph_and_replays_simplification(ec, ec_factory):
    original, operation = prepare(ec)
    short = ec.client.post(
        f"/api/stories/{original['id']}/simplify", json=operation
    ).json()
    backup = ec.client.get("/api/export/backup").json()
    target = ec_factory()
    target.seed_card(word="retired")
    restore(target, backup)
    rows = target.client.get("/api/stories").json()["stories"]
    by_version = {
        target.client.get(f"/api/stories/{r['id']}").json()["version_id"]: r["id"]
        for r in rows
    }
    restored = target.client.get(
        f"/api/stories/{by_version[short['version_id']]}"
    ).json()
    assert restored["mode"] == "short"
    assert restored["parent_version_id"] == original["version_id"]
    assert restored["check_material"] == short["check_material"]
    assert (
        target.client.post(
            f"/api/stories/{by_version[original['version_id']]}/simplify",
            json=operation,
        ).json()
        == restored
    )


from unittest.mock import patch

import pytest


@pytest.mark.parametrize(
    "defect",
    ["length", "sentence", "unknown", "target", "translation", "question", "structure"],
)
def test_el12_short_constraints_preserve_original_on_invalid_generation(ec, defect):
    original, operation = prepare(ec)
    before = ec.snapshot()
    data = short_story()
    if defect == "length":
        data["sentences"] = data["sentences"][:1]
    elif defect == "sentence":
        data["sentences"][0]["en"] = "My apple is on the small table by me."
    elif defect == "unknown":
        data["title"] = "Bright apples dance"
    elif defect == "target":
        data["targets"] = ["book"]
    elif defect == "translation":
        data["sentences"][0]["cn"] = "translation"
    elif defect == "question":
        data["check"]["expected"] = "water"
    else:
        data["sentences"] = None
    ec.app.state.llm_client = QueuedLLM([data, data])
    response = ec.client.post(f"/api/stories/{original['id']}/simplify", json=operation)
    assert response.status_code == 422, response.text
    assert ec.snapshot() == before


def test_el12_commit_failure_and_retry(ec):
    original, operation = prepare(ec)
    path = f"/api/stories/{original['id']}/simplify"
    before = ec.snapshot()
    ec.fail_commit_once()
    assert ec.client.post(path, json=operation).status_code == 500
    assert ec.snapshot() == before
    assert ec.client.post(path, json=operation).status_code == 200
    after = ec.snapshot()
    assert ec.client.post(path, json=operation).status_code == 200
    assert ec.snapshot() == after


@pytest.mark.parametrize(
    "change", ["story_revision", "target_revision", "delete", "restore"]
)
def test_el12_late_generation_cannot_publish_changed_source(ec, change):
    from app.models.story import Story
    from app.services.content_revisions import advance_content_revision
    from app.services.write_transaction import run_write

    original, operation = prepare(ec)
    backup = ec.client.get("/api/export/backup").json()

    def external(*args):
        if change == "story_revision":

            def revise(db):
                advance_content_revision(
                    db, "story", original["id"], {"content": "New content."}
                )
                db.get(Story, original["id"]).content = "New content."

            with ec.SessionLocal() as db:
                run_write(db, revise)
        elif change == "target_revision":
            assert (
                ec.client.put(
                    f"/api/cards/{original['words'][0]['id']}",
                    json={"meaning": "新释义"},
                ).status_code
                == 200
            )
        elif change == "delete":
            assert ec.client.delete(f"/api/stories/{original['id']}").status_code == 200
        else:
            restore(ec, backup)
        return short_story()

    with patch("app.services.story_generator.generate_json", side_effect=external):
        result = ec.client.post(
            f"/api/stories/{original['id']}/simplify", json=operation
        )
    assert result.status_code == 409, result.text
    assert len(ec.snapshot()["extensions"]["story_versions"]) == 1


def test_el12_deleted_versions_and_parent_tombstones_survive_restore(ec, ec_factory):
    original, operation = prepare(ec)
    path = f"/api/stories/{original['id']}/simplify"
    short = ec.client.post(path, json=operation).json()
    assert ec.client.delete(f"/api/stories/{original['id']}").status_code == 200
    assert (
        ec.client.get(f"/api/stories/{short['id']}").json()["version_id"]
        == short["version_id"]
    )
    assert ec.client.post(path, json=operation).status_code == 410
    target = ec_factory()
    restore(target, ec.client.get("/api/export/backup").json())
    assert len(target.snapshot()["extensions"]["story_versions"]) == 2
    assert ec.client.delete(f"/api/stories/{short['id']}").status_code == 200
    restore(target, ec.client.get("/api/export/backup").json())
    assert target.client.get("/api/stories").json()["stories"] == []


@pytest.mark.parametrize(
    "defect", ["missing_parent", "self", "cycle", "normal_parent", "target"]
)
def test_el12_v3_rejects_invalid_parent_graph_before_writes(ec, defect):
    original, operation = prepare(ec)
    ec.client.post(f"/api/stories/{original['id']}/simplify", json=operation)
    before = ec.snapshot()
    backup = ec.client.get("/api/export/backup").json()
    normal, short = backup["extensions"]["story_versions"]
    if defect == "missing_parent":
        short["parent_version_id"] = str(uuid4())
    elif defect == "self":
        short["parent_version_id"] = short["version_id"]
    elif defect == "cycle":
        normal["parent_version_id"] = short["version_id"]
    elif defect == "normal_parent":
        short["mode"] = "normal"
    else:
        short["material"]["targets"] = ["book"]
    assert ec.client.post("/api/import/preview", json=backup).status_code == 422
    assert ec.snapshot() == before


def test_el12_concurrent_same_operation_publishes_once(ec):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    original, operation = prepare(ec)
    barrier = Barrier(2)

    def external(*args):
        barrier.wait(timeout=10)
        return short_story()

    path = f"/api/stories/{original['id']}/simplify"
    with (
        patch("app.services.story_generator.generate_json", side_effect=external),
        ThreadPoolExecutor(max_workers=2) as workers,
    ):
        results = list(
            workers.map(lambda _: ec.client.post(path, json=operation), range(2))
        )
    assert [r.status_code for r in results] == [200, 200]
    assert results[0].json() == results[1].json()
    assert len(ec.snapshot()["extensions"]["story_versions"]) == 2


def test_el12_legacy_version_fields_default_to_normal_without_inventing_results(
    ec, ec_factory
):
    original, _ = prepare(ec)
    backup = ec.client.get("/api/export/backup").json()
    row = backup["extensions"]["story_versions"][0]
    del row["mode"], row["parent_version_id"]
    target = ec_factory()
    restore(target, backup)
    story_id = target.client.get("/api/stories").json()["stories"][0]["id"]
    result = target.client.get(f"/api/stories/{story_id}").json()
    assert result["mode"] == "normal"
    assert result["version_id"] == original["version_id"]
    assert result["parent_version_id"] is None
    assert result["check_status"] == "unchecked"


def test_el12_rollback_disables_simplification_keeps_both_versions_and_v3(ec):
    original, operation = prepare(ec)
    short = ec.client.post(
        f"/api/stories/{original['id']}/simplify", json=operation
    ).json()
    before = ec.snapshot()
    ec.settings.simpler_stories_enabled = False
    assert ec.client.get("/api/stories").json()["simplification_enabled"] is False
    assert (
        ec.client.post(
            f"/api/stories/{original['id']}/simplify", json=operation
        ).status_code
        == 403
    )
    for row in (original, short):
        assert (
            ec.client.get(f"/api/stories/{row['id']}").json()["version_id"]
            == row["version_id"]
        )
    assert ec.snapshot() == before


def test_el12_no_current_known_basis_is_explicit_conflict_not_starter_or_500(ec):
    original, operation = prepare(ec)
    ec.set_time("2026-11-05T03:00:00Z")
    before = ec.snapshot()
    result = ec.client.post(f"/api/stories/{original['id']}/simplify", json=operation)
    assert result.status_code == 409, result.text
    assert ec.snapshot() == before


@pytest.mark.parametrize(
    "count, valid", [(19, False), (20, True), (40, True), (41, False)]
)
def test_el12_short_exact_word_boundaries(count, valid):
    from app.services.story_quality import SUPPORT, validate_story

    data = short_story()
    data["sentences"] = [
        {"en": "My apple is near me.", "cn": "我的苹果在旁边。"}
        for _ in range(4 if count < 30 else 8)
    ]
    if count == 19:
        data["sentences"][-1]["en"] = "I see my book."
    elif count == 41:
        data["sentences"].append({"en": "Now.", "cn": "现在。"})
    errors = validate_story(data, {"apple"}, set(SUPPORT["words"]), "short")
    assert ("length" not in errors) is valid


@pytest.mark.parametrize("failure", ["timeout", "missing"])
def test_el12_external_failure_keeps_versions(ec, failure):
    from app.services.llm_client import LLMNotConfigured

    original, operation = prepare(ec)
    before = ec.snapshot()
    with patch(
        "app.services.story_generator.generate_json",
        return_value=None,
        side_effect=LLMNotConfigured("AI未配置") if failure == "missing" else None,
    ):
        response = ec.client.post(
            f"/api/stories/{original['id']}/simplify", json=operation
        )
    assert response.status_code == (503 if failure == "missing" else 502)
    assert ec.snapshot() == before


def test_el12_source_scope_and_operation_conflicts_never_cross_stories(ec):
    original, operation = prepare(ec)
    ec.app.state.llm_client = QueuedLLM([short_story(), short_story()])
    short = ec.client.post(
        f"/api/stories/{original['id']}/simplify", json=operation
    ).json()
    before = ec.snapshot()
    for story_id, version_id in [
        (short["id"], original["version_id"]),
        (original["id"], short["version_id"]),
        (original["id"], str(uuid4())),
    ]:
        response = ec.client.post(
            f"/api/stories/{story_id}/simplify",
            json={**operation, "version_id": version_id},
        )
        assert response.status_code in (404, 409)
    assert (
        ec.client.post(
            "/api/stories/generate", json={"operation_id": operation["operation_id"]}
        ).status_code
        == 409
    )
    assert ec.snapshot() == before
