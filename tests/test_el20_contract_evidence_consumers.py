"""EL-20 contract boundaries through real HTTP and migrated isolated SQLite."""

from uuid import uuid4

import pytest


def test_el20_unknown_extension_never_silently_disappears(ec):
    payload = ec.client.get("/api/export/backup").json()
    payload["features"].append("unregistered_feature")
    payload["extensions"]["unregistered_feature"] = [{"id": "unknown"}]
    before = ec.snapshot()
    response = ec.client.post("/api/import/preview", json=payload)
    assert response.status_code == 422
    assert ec.snapshot() == before


def test_el20_restore_preserves_equal_time_contact_save_order(ec, ec_factory):
    card_id = ec.seed_card()
    revision = ec.client.get(f"/api/cards/{card_id}").json()["content_revision"]
    for source in ("words_list", "card_detail"):
        response = ec.client.post(
            "/api/learning/contacts",
            json={
                "submission_id": str(uuid4()),
                "card_id": card_id,
                "revision": revision,
                "source": source,
                "kind": "answer_visible",
            },
        )
        assert response.status_code == 200, response.text
    payload = ec.client.get("/api/export/backup").json()
    payload["extensions"]["learning_contacts"].reverse()
    target = ec_factory()
    target.seed_card("replace", id=500)
    preview = target.client.post("/api/import/preview", json=payload)
    assert preview.status_code == 200, preview.text
    restored = target.client.post(
        "/api/import/cards",
        json={
            "backup": payload,
            "expected_revision": preview.json()["expected_revision"],
        },
    )
    assert restored.status_code == 200, restored.text
    mapped = target.client.get("/api/cards").json()["cards"][0]["id"]
    detail = target.client.get(f"/api/cards/{mapped}").json()
    assert detail["last_contact"]["source"] == "card_detail"


def test_el20_registry_keeps_the_published_registration_interface():
    from app.schemas.backup_v3 import register_extension as compatible_register
    from app.schemas.backup_v3 import registered_extensions as compatible_specs
    from app.services.backup_v3_registry import (
        register_extension,
        registered_extensions,
    )

    assert compatible_register is register_extension
    assert compatible_specs is registered_extensions
    assert set(registered_extensions()) == {
        "content_revisions",
        "story_versions",
        "learning_contacts",
        "practice_durations",
        "lesson_progress",
        "practice_sessions",
        "practice_items",
        "scene_attempts",
        "scene_feedback",
    }


def test_el20_extension_names_must_match_without_duplicates():
    from app.services.backup_v3_registry import extension_names_match

    assert extension_names_match([], []) is True
    assert extension_names_match(["contacts"], ["contacts"]) is True
    assert extension_names_match(["contacts", "contacts"], ["contacts"]) is False
    assert extension_names_match(["contacts"], []) is False
    assert extension_names_match([], ["contacts"]) is False


@pytest.mark.parametrize(
    "damage", ["duplicate", "missing", "undeclared", "null", "unknown-empty"]
)
def test_el20_invalid_extension_declarations_reject_preview_and_execution(ec, damage):
    ec.seed_card("keep")
    payload = ec.client.get("/api/export/backup").json()
    if damage == "duplicate":
        payload["features"].append("learning_contacts")
    elif damage == "missing":
        del payload["extensions"]["learning_contacts"]
    elif damage == "undeclared":
        payload["features"].remove("learning_contacts")
    elif damage == "null":
        payload["extensions"]["learning_contacts"] = None
    else:
        payload["features"].append("unknown_empty")
        payload["extensions"]["unknown_empty"] = []
    before = ec.snapshot()
    for path, body in (
        ("/api/import/preview", payload),
        ("/api/import/cards", {"backup": payload, "expected_revision": "invalid"}),
    ):
        response = ec.client.post(path, json=body)
        assert response.status_code == 422, response.text
        assert ec.snapshot() == before
    assert not list((ec.root / "backups").glob("before-restore-*.json"))


def test_el20_registry_exports_every_delivered_persistent_model(ec):
    from app.db import Base
    from app.services.backup import BACKUP_COLLECTIONS, extension_collections
    from app.services.backup_v3_registry import registered_extensions

    payload = ec.client.get("/api/export/backup").json()
    specs = registered_extensions()
    collections = [*BACKUP_COLLECTIONS, *extension_collections()]
    assert {model.__table__.name for _, model in collections} == set(
        Base.metadata.tables
    )
    assert len(collections) == len(Base.metadata.tables)
    assert set(payload["extensions"]) == set(payload["features"]) == set(specs)
    known = {name for name, _ in BACKUP_COLLECTIONS}
    for name, spec in specs.items():
        assert set(spec.parents) <= known, name
        known.add(name)
    first = specs["content_revisions"]
    with pytest.raises(ValueError, match="已登记"):
        from app.schemas.backup_v3 import register_extension

        register_extension(first.name, first.schema, first.parents, first.remap)
    assert ec.client.get("/api/export/backup").json()["features"] == payload["features"]


@pytest.mark.parametrize("version", [1, 2, 3])
def test_el20_older_versions_explain_missing_data_without_inventing_evidence(
    ec, version
):
    ec.seed_card()
    payload = ec.client.get("/api/export/backup").json()
    if version == 1:
        payload = {key: payload[key] for key in ("cards", "reviews", "memos", "errors")}
    elif version == 2:
        payload.pop("features")
        payload.pop("extensions")
        payload["version"] = 2
    else:
        payload["features"] = []
        payload["extensions"] = {}
    before = ec.snapshot()
    preview = ec.client.post("/api/import/preview", json=payload)
    assert preview.status_code == 200, preview.text
    assert "learning_contacts" in preview.json()["extensions"]["missing"]
    assert "practice_durations" in preview.json()["extensions"]["missing"]
    assert preview.json()["targeted_history"] == "not_recorded"
    assert ec.snapshot() == before
    result = ec.client.post(
        "/api/import/cards",
        json={
            "backup": payload,
            "expected_revision": preview.json()["expected_revision"],
        },
    )
    assert result.status_code == 200, result.text
    card = ec.client.get("/api/cards").json()["cards"][0]
    detail = ec.client.get(f"/api/cards/{card['id']}").json()
    assert detail["last_contact"] is None
    assert detail["learning_evidence"]["recall"]["status"] == "insufficient"
    assert ec.snapshot()["learning_events"] == []


def test_el20_revision_reversal_and_cached_replay_cannot_reissue_current_evidence(
    ec, ec_factory
):
    card_id = ec.seed_card()
    revision = ec.client.get(f"/api/cards/{card_id}").json()["content_revision"]
    commands, responses = [], []
    for now in ("2026-10-01T01:00:00Z", "2026-10-02T01:00:00Z"):
        ec.set_time(now)
        command = {
            "card_id": card_id,
            "revision": revision,
            "user_input": "apple",
            "source": "spelling",
            "submission_id": str(uuid4()),
            "assistance": [],
        }
        response = ec.client.post("/api/typing/check", json=command)
        assert response.status_code == 200, response.text
        commands.append(command)
        responses.append(response.json())
    assert ec.client.get("/api/stats").json()["evidence_counts"]["verified"] == 1
    for meaning in ("另一个含义", "苹果"):
        assert (
            ec.client.put(
                f"/api/cards/{card_id}", json={"meaning": meaning}
            ).status_code
            == 200
        )
    payload = ec.client.get("/api/export/backup").json()
    target = ec_factory()
    target.seed_card("retire", id=600)
    preview = target.client.post("/api/import/preview", json=payload).json()
    assert (
        target.client.post(
            "/api/import/cards",
            json={
                "backup": payload,
                "expected_revision": preview["expected_revision"],
            },
        ).status_code
        == 200
    )
    mapped = target.client.get("/api/cards").json()["cards"][0]["id"]
    before = target.snapshot()
    for command, original in zip(commands, responses):
        replay = target.client.post(
            "/api/typing/check", json={**command, "card_id": mapped}
        )
        assert replay.status_code == 200, replay.text
        assert replay.json() == {**original, "card_id": mapped}
    assert target.snapshot() == before
    stale = target.client.post(
        "/api/typing/check",
        json={
            **commands[0],
            "card_id": mapped,
            "submission_id": str(uuid4()),
        },
    )
    assert stale.status_code == 409
    assert target.snapshot() == before
    for path in ("/api/today", "/api/stats"):
        counts = target.client.get(path).json()["evidence_counts"]
        assert counts["verified"] == 0
        assert counts["insufficient"] == 1
    assert (
        target.client.get(f"/api/cards/{mapped}").json()["content_revision"]["version"]
        == 3
    )
    assert target.client.delete(f"/api/cards/{mapped}").status_code == 200
    assert (
        target.client.post(
            "/api/typing/check",
            json={
                **commands[0],
                "card_id": mapped,
                "submission_id": str(uuid4()),
            },
        ).status_code
        == 404
    )
    assert target.client.get("/api/stats").json()["evidence_counts"]["verified"] == 0


def test_el20_contact_failure_parallel_confirmation_and_restore_stale_request(
    ec, ec_factory
):
    from concurrent.futures import ThreadPoolExecutor

    card_id = ec.seed_card()
    revision = ec.client.get(f"/api/cards/{card_id}").json()["content_revision"]
    command = {
        "card_id": card_id,
        "revision": revision,
        "source": "card_detail",
        "kind": "answer_visible",
        "submission_id": str(uuid4()),
    }
    before = ec.snapshot()
    ec.fail_commit_once()
    assert ec.client.post("/api/learning/contacts", json=command).status_code == 500
    assert ec.snapshot() == before
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(
            pool.map(
                lambda _: ec.client.post("/api/learning/contacts", json=command),
                range(2),
            )
        )
    assert [r.status_code for r in results] == [200, 200]
    assert results[0].json() == results[1].json()
    assert (
        ec.client.post(
            "/api/learning/contacts", json={**command, "source": "words_list"}
        ).status_code
        == 409
    )
    assert len(ec.snapshot()["extensions"]["learning_contacts"]) == 1
    assert ec.snapshot()["learning_events"] == ec.snapshot()["reviews"] == []
    payload = ec.client.get("/api/export/backup").json()
    target = ec_factory()
    target.seed_card("retire", id=600)
    preview = target.client.post("/api/import/preview", json=payload).json()
    assert (
        target.client.post(
            "/api/import/cards",
            json={
                "backup": payload,
                "expected_revision": preview["expected_revision"],
            },
        ).status_code
        == 200
    )
    mapped = target.client.get("/api/cards").json()["cards"][0]["id"]
    stable = target.snapshot()
    # An unsaved request from before replacement cannot target a retired ID.
    assert (
        target.client.post(
            "/api/learning/contacts", json={**command, "submission_id": str(uuid4())}
        ).status_code
        == 404
    )
    # A saved UUID can replay using the mapped live card; it keeps original time.
    replay = target.client.post(
        "/api/learning/contacts", json={**command, "card_id": mapped}
    )
    assert replay.status_code == 200, replay.text
    assert replay.json()["occurred_at"] == results[0].json()["occurred_at"]
    assert target.snapshot() == stable


def test_el20_reading_export_and_preview_are_not_learning(ec):
    card_id = ec.seed_card()
    payload = ec.client.get("/api/export/backup").json()
    before = ec.snapshot()
    for _ in range(2):
        for path in (
            "/api/export/backup",
            "/api/cards",
            f"/api/cards/{card_id}",
            "/api/today",
            "/api/stats",
        ):
            assert ec.client.get(path).status_code == 200
        assert ec.client.post("/api/import/preview", json=payload).status_code == 200
    assert ec.snapshot() == before


def test_el20_functional_rollback_keeps_public_reads_and_new_records(ec):
    card_id = ec.seed_card()
    revision = ec.client.get(f"/api/cards/{card_id}").json()["content_revision"]
    assert (
        ec.client.post(
            "/api/learning/contacts",
            json={
                "card_id": card_id,
                "revision": revision,
                "source": "card_detail",
                "kind": "answer_visible",
                "submission_id": str(uuid4()),
            },
        ).status_code
        == 200
    )
    assert (
        ec.client.post(
            "/api/typing/check",
            json={
                "card_id": card_id,
                "user_input": "apple",
                "source": "spelling",
                "submission_id": str(uuid4()),
                "assistance": [],
            },
        ).status_code
        == 200
    )
    before = ec.snapshot()
    ec.settings.learning_advice_enabled = False
    ec.settings.delayed_recall_enabled = False
    ec.settings.scenes_enabled = False
    ec.settings.personal_estimates_enabled = False
    ec.settings.recovery_mode_enabled = False
    ec.restart()
    today = ec.client.get("/api/today").json()
    assert today["scenes_enabled"] is False
    assert ec.client.get("/api/export/cards").status_code == 200
    assert (
        ec.client.get(f"/api/cards/{card_id}").json()["learning_evidence"]["recall"][
            "count"
        ]
        == 1
    )
    assert ec.snapshot() == before
    assert (
        ec.client.post(
            "/api/import/preview", json=ec.client.get("/api/export/backup").json()
        ).status_code
        == 200
    )
