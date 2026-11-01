"""EL-04：看词卡或听答案后，能核对最近一次应用内接触。

测试 seam：真实 FastAPI → Alembic 迁移建立的隔离 SQLite。
模型只用于准备前置数据，实际被测行为走公开 HTTP。
"""

import copy
from uuid import uuid4

import pytest

from app.services.contacts import contact_time


def _revision(ec, card_id):
    return ec.client.get(f"/api/cards/{card_id}").json()["content_revision"]


def _contact(
    ec,
    card_id,
    revision,
    *,
    source="card_detail",
    kind="answer_visible",
    submission_id=None,
    **extra,
):
    return ec.client.post(
        "/api/learning/contacts",
        json={
            "submission_id": submission_id or str(uuid4()),
            "card_id": card_id,
            "revision": revision,
            "source": source,
            "kind": kind,
            **extra,
        },
    )


def _contacts(ec):
    return ec.client.get("/api/export/backup").json()["extensions"][
        "learning_contacts"
    ]


def _without_contacts(payload):
    payload = copy.deepcopy(payload)
    payload["features"] = [
        feature for feature in payload["features"] if feature != "learning_contacts"
    ]
    payload["extensions"].pop("learning_contacts", None)
    return payload


def test_el04_confirmed_contact_is_not_an_attempt(ec):
    card_id = ec.seed_card()
    revision = _revision(ec, card_id)
    detail = ec.client.get(f"/api/cards/{card_id}").json()
    assert detail["last_contact"] is None
    assert detail["contact_integrity"]["status"] == "unknown"

    saved = _contact(ec, card_id, revision)
    assert saved.status_code == 200, saved.text
    assert saved.json()["committed"] is True

    detail = ec.client.get(f"/api/cards/{card_id}").json()
    assert detail["last_contact"]["occurred_at"] == saved.json()["occurred_at"]
    assert detail["last_contact"]["source"] == "card_detail"
    assert detail["last_contact"]["kind"] == "answer_visible"
    assert detail["last_contact"]["card_revision"] == revision["version"]
    assert detail["contact_integrity"] == {
        "status": "confirmed",
        "basis": "server_confirmed",
        "label": "服务端确认时间",
    }
    assert detail["learning_events"] == []


@pytest.mark.parametrize(
    "arguments, expected",
    [
        (["2026-10-31T00:00:00Z", None, True, False], "2026-10-31T00:00:00Z"),
        (
            ["2026-10-31T00:00:00Z", "2026-10-01T00:00:00Z", True, False],
            "2026-10-31T00:00:00Z",
        ),
        (["now", None, False, False], None),
        (["now", None, True, True], None),
        (["now", None, False, True], None),
    ],
)
def test_el04_review_focus(arguments, expected):
    assert contact_time(*arguments) == expected


@pytest.mark.parametrize(
    "change",
    [
        {"source": "unknown_place"},
        {"kind": "heardsay"},
        {"card_id": 0},
        {"revision": {"identity": "not-a-uuid", "version": 1}},
        {"revision": {"identity": "00000000-0000-0000-0000-000000000000", "version": 0}},
        {"submission_id": "not-a-uuid"},
    ],
)
def test_el04_invalid_combinations_are_rejected(ec, change):
    card_id = ec.seed_card()
    payload = {
        "submission_id": str(uuid4()),
        "card_id": card_id,
        "revision": _revision(ec, card_id),
        "source": "card_detail",
        "kind": "answer_visible",
        **change,
    }
    assert (
        ec.client.post("/api/learning/contacts", json=payload).status_code == 422
    )
    assert _contacts(ec) == []


def test_el04_revision_and_deleted_target_are_rejected(ec):
    card_id = ec.seed_card()
    revision = _revision(ec, card_id)
    changed = {**revision, "version": revision["version"] + 1}
    assert _contact(ec, card_id, changed).status_code == 409
    other_identity = {**revision, "identity": str(uuid4())}
    assert _contact(ec, card_id, other_identity).status_code == 409
    assert _contacts(ec) == []

    assert ec.client.delete(f"/api/cards/{card_id}").status_code == 200
    assert _contact(ec, card_id, revision).status_code == 404
    assert _contacts(ec) == []


def test_el04_duplicate_confirmation_is_idempotent(ec):
    card_id = ec.seed_card()
    revision = _revision(ec, card_id)
    submission_id = str(uuid4())
    first = _contact(ec, card_id, revision, submission_id=submission_id)
    replay = _contact(ec, card_id, revision, submission_id=submission_id)
    assert first.status_code == replay.status_code == 200
    assert replay.json() == first.json()
    assert len(_contacts(ec)) == 1

    conflict = _contact(
        ec,
        card_id,
        revision,
        submission_id=submission_id,
        kind="answer_audio",
    )
    assert conflict.status_code == 409
    assert len(_contacts(ec)) == 1


def test_el04_client_cannot_backdate_confirmation(ec):
    card_id = ec.seed_card()
    revision = _revision(ec, card_id)
    ec.set_time("2026-10-30T12:00:00Z")
    saved = _contact(
        ec,
        card_id,
        revision,
        occurred_at="2026-10-01T00:00:00Z",
        client_at="2026-10-01T00:00:00Z",
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["occurred_at"] == "2026-10-30T12:00:00+00:00"
    assert _contacts(ec)[0]["occurred_at"].startswith("2026-10-30T12:00:00")


def test_el04_delayed_confirmation_uses_server_time(ec):
    card_id = ec.seed_card()
    revision = _revision(ec, card_id)
    ec.set_time("2026-10-30T12:00:00Z")
    first = _contact(ec, card_id, revision)
    assert first.json()["occurred_at"] == "2026-10-30T12:00:00+00:00"
    ec.set_time("2026-10-31T09:00:00Z")
    replay = _contact(ec, card_id, revision, submission_id=str(uuid4()))
    assert replay.json()["occurred_at"] == "2026-10-31T09:00:00+00:00"
    assert [row["occurred_at"][:19] for row in _contacts(ec)] == [
        "2026-10-30T12:00:00",
        "2026-10-31T09:00:00",
    ]


def test_el04_content_change_after_display_conflicts(ec):
    card_id = ec.seed_card(meaning="苹果")
    displayed = _revision(ec, card_id)
    assert (
        ec.client.put(f"/api/cards/{card_id}", json={"meaning": "一个苹果"}).status_code
        == 200
    )
    assert _contact(ec, card_id, displayed).status_code == 409
    assert _contacts(ec) == []
    detail = ec.client.get(f"/api/cards/{card_id}").json()
    assert detail["last_contact"] is None
    assert detail["contact_integrity"]["status"] == "unknown"
    assert detail["learning_events"] == []


def test_el04_commit_failure_and_retry(ec):
    card_id = ec.seed_card()
    revision = _revision(ec, card_id)
    submission_id = str(uuid4())
    before = ec.snapshot()

    ec.fail_commit_once()
    failed = _contact(ec, card_id, revision, submission_id=submission_id)
    assert failed.status_code == 500
    assert ec.snapshot() == before

    saved = _contact(ec, card_id, revision, submission_id=submission_id)
    assert saved.status_code == 200, saved.text
    after = ec.snapshot()
    assert len(after["extensions"]["learning_contacts"]) == 1
    replay = _contact(ec, card_id, revision, submission_id=submission_id)
    assert replay.status_code == 200
    assert replay.json() == saved.json()
    assert ec.snapshot() == after


def test_el04_contact_does_not_touch_learning_or_daily_counts(ec):
    card_id = ec.seed_card()
    revision = _revision(ec, card_id)
    before = ec.snapshot()
    stats_before = ec.client.get("/api/stats").json()

    assert _contact(ec, card_id, revision).status_code == 200
    after = ec.snapshot()
    assert _without_contacts(after) == _without_contacts(before)
    assert ec.client.get("/api/stats").json() == stats_before
    detail = ec.client.get(f"/api/cards/{card_id}").json()
    assert detail["learning_events"] == []
    assert detail["review_count"] == 0
    assert detail["memory_state"] is None


def test_el04_contact_survives_restart(ec):
    card_id = ec.seed_card()
    revision = _revision(ec, card_id)
    saved = _contact(ec, card_id, revision).json()
    ec.restart()
    detail = ec.client.get(f"/api/cards/{card_id}").json()
    assert detail["last_contact"]["occurred_at"] == saved["occurred_at"]
    assert detail["last_contact"]["card_identity"] == revision["identity"]
    assert detail["last_contact"]["card_revision"] == revision["version"]
    assert detail["learning_events"] == []


def test_el04_delete_card_removes_contacts(ec):
    card_id = ec.seed_card()
    assert _contact(ec, card_id, _revision(ec, card_id)).status_code == 200
    assert ec.client.delete(f"/api/cards/{card_id}").status_code == 200
    assert _contacts(ec) == []


def test_el04_v3_roundtrip_keeps_contact_time_and_revision(ec, ec_factory):
    card_id = ec.seed_card(meaning="苹果")
    displayed = _revision(ec, card_id)
    saved = _contact(
        ec,
        card_id,
        displayed,
        source="words_list",
        kind="answer_audio",
    ).json()
    # 展幕后内容被修订：旧接触仍归属于当时看到的修订。
    assert (
        ec.client.put(f"/api/cards/{card_id}", json={"meaning": "一个苹果"}).status_code
        == 200
    )
    backup = ec.client.get("/api/export/backup").json()
    assert "learning_contacts" in backup["features"]
    assert backup["extensions"]["learning_contacts"][0]["submission_id"]

    target = ec_factory()
    preview = target.client.post("/api/import/preview", json=backup)
    assert preview.status_code == 200, preview.text
    assert preview.json()["extensions"] == {
        "provided": ["content_revisions", "learning_contacts"],
        "missing": [],
    }
    restored = target.client.post(
        "/api/import/cards",
        json={
            "backup": backup,
            "expected_revision": preview.json()["expected_revision"],
        },
    )
    assert restored.status_code == 200, restored.text

    card = next(
        row for row in target.client.get("/api/export/backup").json()["cards"]
        if row["word"] == "apple"
    )
    detail = target.client.get(f"/api/cards/{card['id']}").json()
    assert detail["content_revision"]["version"] == displayed["version"] + 1
    assert detail["last_contact"]["occurred_at"] == saved["occurred_at"]
    assert detail["last_contact"]["card_identity"] == displayed["identity"]
    assert detail["last_contact"]["card_revision"] == displayed["version"]
    assert detail["last_contact"]["source"] == "words_list"
    assert detail["last_contact"]["kind"] == "answer_audio"
    assert detail["contact_integrity"]["status"] == "confirmed"
    # 恢复后的新接触仍按当前修订确认，旧记录不被改写。
    assert (
        _contact(target, card["id"], detail["content_revision"]).status_code == 200
    )
    assert len(_contacts(target)) == 2


def test_el04_old_v3_without_contacts_stays_unknown(ec, ec_factory):
    card_id = ec.seed_card()
    assert _contact(ec, card_id, _revision(ec, card_id)).status_code == 200
    backup = _without_contacts(ec.client.get("/api/export/backup").json())
    assert "learning_contacts" not in backup["features"]

    target = ec_factory()
    preview = target.client.post("/api/import/preview", json=backup)
    assert preview.status_code == 200, preview.text
    assert preview.json()["extensions"]["missing"] == ["learning_contacts"]
    assert (
        target.client.post(
            "/api/import/cards",
            json={
                "backup": backup,
                "expected_revision": preview.json()["expected_revision"],
            },
        ).status_code
        == 200
    )
    card = next(
        row for row in target.client.get("/api/export/backup").json()["cards"]
        if row["word"] == "apple"
    )
    detail = target.client.get(f"/api/cards/{card['id']}").json()
    assert detail["last_contact"] is None
    assert detail["contact_integrity"] == {
        "status": "unknown",
        "basis": "missing_history",
        "label": "旧数据未记录，接触依据未知",
    }


def test_el04_full_replace_clears_existing_contacts(ec, ec_factory):
    source = ec_factory()
    source.seed_card()
    backup = _without_contacts(
        source.client.get("/api/export/backup").json()
    )
    target = ec_factory()
    target_card = target.seed_card()
    assert (
        _contact(target, target_card, _revision(target, target_card)).status_code
        == 200
    )
    assert len(_contacts(target)) == 1

    preview = target.client.post("/api/import/preview", json=backup)
    assert preview.status_code == 200, preview.text
    assert preview.json()["extensions"]["missing"] == ["learning_contacts"]
    assert (
        target.client.post(
            "/api/import/cards",
            json={
                "backup": backup,
                "expected_revision": preview.json()["expected_revision"],
            },
        ).status_code
        == 200
    )
    assert _contacts(target) == []
    card = next(
        row for row in target.client.get("/api/export/backup").json()["cards"]
        if row["word"] == "apple"
    )
    detail = target.client.get(f"/api/cards/{card['id']}").json()
    assert detail["last_contact"] is None
    assert detail["contact_integrity"]["status"] == "unknown"


@pytest.mark.parametrize(
    "mutation",
    [
        "dangling-card",
        "duplicate-submission",
        "bad-identity",
        "bad-version",
        "wrong-identity",
        "future-version",
        "missing-revisions",
    ],
)
def test_el04_v3_rejects_broken_contact_graph(ec, ec_factory, mutation):
    source = ec_factory()
    card_id = source.seed_card()
    assert _contact(source, card_id, _revision(source, card_id)).status_code == 200
    backup = source.client.get("/api/export/backup").json()
    row = backup["extensions"]["learning_contacts"][0]
    if mutation == "dangling-card":
        row["card_id"] = 999999
    elif mutation == "duplicate-submission":
        backup["extensions"]["learning_contacts"].append({**row, "id": row["id"] + 1})
    elif mutation == "bad-identity":
        row["card_identity"] = "not-a-uuid"
    elif mutation == "bad-version":
        row["card_revision"] = 0
    elif mutation == "wrong-identity":
        row["card_identity"] = "00000000-0000-4000-8000-000000000000"
    elif mutation == "future-version":
        row["card_revision"] = 99
    else:
        backup["features"].remove("content_revisions")
        backup["extensions"].pop("content_revisions")

    target = ec_factory()
    target.seed_card("keep")
    untouched = target.snapshot()
    preview = target.client.post("/api/import/preview", json=backup)
    assert preview.status_code == 422, preview.text
    assert target.snapshot() == untouched
    confirmed = target.client.post(
        "/api/import/cards",
        json={"backup": backup, "expected_revision": "irrelevant"},
    )
    assert confirmed.status_code == 422
    assert target.snapshot() == untouched
