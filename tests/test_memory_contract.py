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


def test_contract_archives_duplicate_states_and_preserves_allocator(ec):
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
