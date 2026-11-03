"""EL-20 contract boundaries through real HTTP and migrated isolated SQLite."""

from uuid import uuid4


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
