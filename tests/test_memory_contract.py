"""EC-15 current-state constraint and non-destructive migration contract."""

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.review import Review


def test_current_memory_rejects_second_state(ec):
    cid = ec.seed_card()
    assert (
        ec.client.post("/api/reviews", json={"card_id": cid, "rating": 3}).status_code
        == 200
    )
    with Session(ec.engine) as db:
        current = db.query(Review).filter_by(card_id=cid).one()
        duplicate = Review(
            **{
                column.name: getattr(current, column.name)
                for column in Review.__table__.columns
                if column.name != "id"
            }
        )
        db.add(duplicate)
        with pytest.raises(IntegrityError):
            db.commit()


def test_contract_archives_duplicate_states_and_preserves_allocator(ec, ec_factory):
    import json
    from pathlib import Path

    from alembic.config import Config
    from sqlalchemy import text

    from alembic import command

    cid = ec.seed_card()
    assert (
        ec.client.post("/api/reviews", json={"card_id": cid, "rating": 3}).status_code
        == 200
    )
    cfg = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", ec.database_url)
    command.downgrade(cfg, "ec12_card_identity")
    with ec.engine.begin() as conn:
        conn.execute(
            text("INSERT INTO cards (id, word, kind) VALUES (999, 'retired', 'word')")
        )
        conn.execute(text("DELETE FROM cards WHERE id = 999"))
        conn.execute(
            text(
                "INSERT INTO reviews (id, card_id, state, step, due, stability, difficulty, "
                "elapsed_days, last_review, review_count, rating) VALUES "
                "(99, :cid, 1, 0, '2026-10-29 12:00:00', 1, 5, 0, NULL, 5, 2)"
            ),
            {"cid": cid},
        )
        before = conn.execute(text("SELECT * FROM review_events")).all()
    command.upgrade(cfg, "head")
    with ec.engine.connect() as conn:
        rows = conn.execute(text("SELECT * FROM reviews")).mappings().all()
        assert len(rows) == 1
        assert (
            rows[0]["id"] != 99
        )  # Valid activity beats the larger ID with unknown time.
        archived = conn.execute(text("SELECT * FROM review_baselines")).mappings().all()
        assert len(archived) == 2
        assert {json.loads(r["raw"])["id"] for r in archived} == {rows[0]["id"], 99}
        assert all(r["source_kind"] == "contract_archive" for r in archived)
        assert [r["source_review_id"] for r in archived if r["selected"]] == [
            rows[0]["id"]
        ]
        assert conn.execute(text("SELECT * FROM review_events")).all() == before
        assert (
            conn.execute(
                text("SELECT seq FROM sqlite_sequence WHERE name='cards'")
            ).scalar_one()
            == 999
        )
    command.downgrade(cfg, "ec12_card_identity")
    command.upgrade(cfg, "head")
    backup = ec.client.get("/api/export/backup").json()
    assert len(backup["review_baselines"]) == 2
    assert len(backup["learning_events"]) == 1
    target = ec_factory()
    target.seed_card(
        "replace-me"
    )  # Force a new live card ID, while raw evidence stays original.
    preview = target.client.post("/api/import/preview", json=backup)
    assert preview.status_code == 200, preview.text
    restored = target.client.post(
        "/api/import/cards",
        json={
            "backup": backup,
            "expected_revision": preview.json()["expected_revision"],
        },
    )
    assert restored.status_code == 200
    new_id = target.client.get("/api/export/backup").json()["cards"][0]["id"]
    assert new_id != cid
    assert len(target.client.get("/api/export/backup").json()["review_baselines"]) == 2


def test_duplicate_v2_current_states_are_rejected_before_write(ec):
    from copy import deepcopy

    cid = ec.seed_card()
    assert (
        ec.client.post("/api/reviews", json={"card_id": cid, "rating": 3}).status_code
        == 200
    )
    before = ec.snapshot()
    invalid = deepcopy(ec.client.get("/api/export/backup").json())
    invalid["reviews"].append({**invalid["reviews"][0], "id": 900})
    preview = ec.client.post("/api/import/preview", json=invalid)
    assert preview.status_code == 422
    issue = preview.json()["detail"][0]
    assert issue["collection"] == "reviews"
    assert issue["field"] == "card_id"
    # Even with a genuine revision, validation must precede backup or writes.
    valid_preview = ec.client.post(
        "/api/import/preview", json=ec.client.get("/api/export/backup").json()
    ).json()
    restored = ec.client.post(
        "/api/import/cards",
        json={
            "backup": invalid,
            "expected_revision": valid_preview["expected_revision"],
        },
    )
    assert restored.status_code == 422
    assert ec.snapshot() == before


def test_contract_rejects_unsafe_duplicate_before_archiving(ec):
    from pathlib import Path

    from alembic.config import Config
    from sqlalchemy import text

    from alembic import command

    cid = ec.seed_card()
    cfg = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", ec.database_url)
    command.downgrade(cfg, "ec12_card_identity")
    with ec.engine.begin() as conn:
        for count in (1, -1):
            conn.execute(
                text(
                    "INSERT INTO reviews (card_id, state, due, stability, difficulty, "
                    "elapsed_days, review_count) VALUES (:cid, 1, '2026-10-29', 1, 5, 0, :count)"
                ),
                {"cid": cid, "count": count},
            )
    with pytest.raises(RuntimeError, match="reviews.*review_count"):
        command.upgrade(cfg, "head")
    with ec.engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM reviews")).scalar_one() == 2
        assert (
            conn.execute(text("SELECT COUNT(*) FROM review_baselines")).scalar_one()
            == 0
        )
        assert (
            conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
            == "ec12_card_identity"
        )


def test_archived_unknown_history_remains_readable_after_v2_restore(ec, ec_factory):
    from uuid import uuid4

    cid = ec.seed_card()
    backup = ec.client.get("/api/export/backup").json()
    backup["review_baselines"].append(
        {
            "id": str(uuid4()),
            "card_id": cid,
            "source_review_id": None,
            "source_kind": "legacy_import",
            "raw": {"last_review": "unknown", "review_count": 2},
            "selected": False,
            "captured_at": "2026-10-30T12:00:00",
            "last_activity": None,
            "cumulative_count": 2,
            "source_fingerprint": "f" * 64,
        }
    )
    target = ec_factory()
    preview = target.client.post("/api/import/preview", json=backup)
    assert preview.status_code == 200
    result = target.client.post(
        "/api/import/cards",
        json={
            "backup": backup,
            "expected_revision": preview.json()["expected_revision"],
        },
    )
    assert result.status_code == 200
    restored = target.client.get("/api/export/backup").json()
    response = target.client.get(f"/api/cards/{restored['cards'][0]['id']}")
    assert response.status_code == 200
    assert response.json()["learning_events"] == []
    assert response.json()["history_incomplete"] is True
    assert (
        restored["review_baselines"][0]["raw"] == backup["review_baselines"][0]["raw"]
    )


def _prepare_contract_preflight(ec):
    """Real saved activity plus prior-revision legacy duplicates and audit evidence."""
    from pathlib import Path

    from alembic.config import Config
    from sqlalchemy import text

    from alembic import command

    cid = ec.seed_card()
    assert (
        ec.client.post("/api/reviews", json={"card_id": cid, "rating": 3}).status_code
        == 200
    )
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", ec.database_url)
    command.downgrade(config, "ec12_card_identity")
    with ec.engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO reviews (id, card_id, state, step, due, stability, difficulty, "
                "elapsed_days, last_review, review_count, rating) VALUES "
                "(99, :cid, 1, 0, '2026-10-29 12:00:00', 1, 5, 0, '2026-10-29 12:00:00', 1, 2)"
            ),
            {"cid": cid},
        )
        conn.execute(
            text(
                "INSERT INTO review_baselines (id, card_id, source_review_id, source_kind, raw, "
                "selected, captured_at, last_activity, cumulative_count, source_fingerprint) "
                "VALUES ('00000000-0000-4000-8000-000000000001', :cid, NULL, 'migration', "
                "'{\"evidence\":\"unchanged\"}', 0, '2026-10-29 12:00:00', NULL, 0, :fp)"
            ),
            {"cid": cid, "fp": "a" * 64},
        )
        current_id = conn.execute(
            text("SELECT id FROM reviews WHERE id != 99")
        ).scalar_one()
    return config, cid, current_id


def _preflight_snapshot(ec):
    from sqlalchemy import text

    with ec.engine.connect() as conn:
        return {
            table: conn.execute(text(f'SELECT * FROM "{table}" ORDER BY 1')).all()
            for table in (
                "reviews",
                "review_events",
                "review_baselines",
                "alembic_version",
                "sqlite_sequence",
            )
        }


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("stability", -1),
        ("difficulty", -1),
        ("difficulty", 10.01),
        ("step", -1),
        ("step", 0.5),
        ("review_count", -1),
        ("review_count", 0.5),
        ("elapsed_days", -1),
        ("elapsed_days", 0.5),
        ("state", -1),
        ("state", 4),
        ("state", 1.5),
        ("rating", 0),
        ("rating", 5),
        ("rating", 1.5),
        ("stability", float("inf")),
        ("difficulty", float("inf")),
    ],
)
def test_contract_preflight_rejects_invalid_fsrs_without_changes(ec, field, value):
    from sqlalchemy import text

    from alembic import command

    config, _, current_id = _prepare_contract_preflight(ec)
    with ec.engine.begin() as conn:
        conn.execute(
            text(f"UPDATE reviews SET {field} = :value WHERE id = :id"),
            {"value": value, "id": current_id},
        )
    before = _preflight_snapshot(ec)
    with pytest.raises(RuntimeError, match=f"reviews.*{field}"):
        command.upgrade(config, "head")
    assert _preflight_snapshot(ec) == before


@pytest.mark.parametrize(
    ("step", "rating", "difficulty"), [(None, None, 0), (0, 4, 10)]
)
def test_contract_preflight_preserves_valid_zero_and_unknown_fields(
    ec, step, rating, difficulty
):
    from sqlalchemy import text

    from alembic import command

    config, cid, _ = _prepare_contract_preflight(ec)
    with ec.engine.begin() as conn:
        conn.execute(
            text(
                "UPDATE reviews SET state=0, step=:step, stability=0, difficulty=:difficulty, "
                "review_count=0, elapsed_days=0, last_review=NULL, rating=:rating"
            ),
            {"step": step, "difficulty": difficulty, "rating": rating},
        )
    before = _preflight_snapshot(ec)
    command.upgrade(config, "head")
    detail = ec.client.get(f"/api/cards/{cid}")
    assert detail.status_code == 200
    memory = detail.json()["memory_state"]
    assert memory["state"] == memory["review_count"] == memory["stability"] == 0
    assert memory["difficulty"] == difficulty
    assert memory["step"] == step
    assert memory["rating"] == rating
    assert memory["last_review"] is None
    after = _preflight_snapshot(ec)
    assert after["review_events"] == before["review_events"]
    assert after["sqlite_sequence"] == before["sqlite_sequence"]
    backup = ec.client.get("/api/export/backup").json()
    assert len(backup["reviews"]) == 1
    assert len(backup["review_baselines"]) == 3
    preview = ec.client.post("/api/import/preview", json=backup)
    assert preview.status_code == 200, preview.text
