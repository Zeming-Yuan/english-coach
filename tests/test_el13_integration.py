"""EL-12 / EL-13 integration through the existing migration and HTTP seams."""

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text

from alembic import command
from tests.test_el11_bounded_personalized_story import restore
from tests.test_el12_simpler_story_version import prepare
from tests.test_el13_story_reading_check import attempt, create_check


def test_story_migrations_have_one_upgrade_head():
    assert len(ScriptDirectory.from_config(Config("alembic.ini")).get_heads()) == 1


def test_simpler_checks_keep_both_questions_and_separate_restored_results(
    ec, ec_factory
):
    original, operation = prepare(ec)
    short = ec.client.post(
        f"/api/stories/{original['id']}/simplify", json=operation
    ).json()
    run = create_check(ec, short).json()
    assert [item["kind"] for item in run["items"]] == ["reading_choice", "typed"]
    assert attempt(ec, run, 0).status_code == 200
    assert attempt(ec, run, 1).status_code == 200
    assert (
        ec.client.get(f"/api/stories/{original['id']}").json()["check_session_id"]
        is None
    )
    assert (
        ec.client.get(f"/api/stories/{short['id']}").json()["check_session_id"]
        == run["id"]
    )
    target = ec_factory()
    target.seed_card(word="retired")
    restore(target, ec.client.get("/api/export/backup").json())
    restored = target.client.get(f"/api/practice-sessions/{run['id']}").json()
    assert restored["version_id"] == short["version_id"]
    assert restored["reading_checks"] == {
        "recognition_count": 1,
        "independent_count": 1,
        "assisted_count": 0,
    }


@pytest.mark.parametrize("previous", ["el12_simpler_story", "el13_story_checks"])
def test_each_story_branch_upgrades_to_the_same_head_without_losing_rows(
    tmp_path, previous
):
    config = Config("alembic.ini")
    url = f"sqlite:///{tmp_path / 'upgrade.db'}"
    config.set_main_option("sqlalchemy.url", url)
    command.upgrade(config, previous)
    engine = create_engine(url)
    with engine.begin() as connection:
        connection.execute(
            text("INSERT INTO cards (word, kind) VALUES ('preserved', 'word')")
        )
        connection.execute(
            text(
                "INSERT INTO practice_sessions "
                "(session_id, purpose, status, rule_version, created_at) "
                "VALUES ('saved-round', 'targeted', 'active', 'el08-v1', '2026-11-01')"
            )
        )
        connection.execute(
            text(
                "INSERT INTO practice_items "
                "(item_id, session_id, position, card_id, card_identity, card_revision, prompt, kind, assistance, created_at) "
                "VALUES ('saved-item', 'saved-round', 1, 1, 'saved-card', 1, '保留题目', 'typed', '[\"first_letter\"]', '2026-11-01')"
            )
        )
        before = {
            table: [
                dict(row._mapping)
                for row in connection.execute(text(f"SELECT * FROM {table}"))
            ]
            for table in ("cards", "practice_sessions", "practice_items")
        }
    command.upgrade(config, "head")
    command.upgrade(config, "head")
    with engine.connect() as connection:
        for table, rows in before.items():
            after = [
                dict(row._mapping)
                for row in connection.execute(text(f"SELECT * FROM {table}"))
            ]
            assert [{key: row[key] for key in rows[0]} for row in after] == rows
        assert connection.scalar(text("SELECT word FROM cards")) == "preserved"
        assert (
            connection.scalar(text("SELECT version_num FROM alembic_version"))
            == "el16_feedback_epoch"
        )
    assert {c["name"] for c in inspect(engine).get_columns("story_versions")} >= {
        "mode",
        "parent_version_id",
    }
    assert "version_id" in {
        c["name"] for c in inspect(engine).get_columns("practice_sessions")
    }
    engine.dispose()
