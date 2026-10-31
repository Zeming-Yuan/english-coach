"""Card identities remain retired across empty restores and process restarts."""

import json
import sqlite3
from pathlib import Path

from alembic.config import Config
from sqlalchemy import create_engine

from alembic import command
from e2e.support.fixture_loader import load_fixture
from tests.support.ec_env import ECEnv

ROOT = Path(__file__).resolve().parents[1]


def test_upgrade_preserves_graph_and_retired_card_ids_for_normal_inserts(tmp_path):
    root = tmp_path / "upgrade"
    root.mkdir()
    database = root / "test.db"
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database}")
    command.upgrade(config, "b1c2d3e4f502")
    fixture = json.loads((ROOT / "e2e/fixtures/ec12-full.json").read_text())
    engine = create_engine(f"sqlite:///{database}")
    try:
        load_fixture(engine, fixture)
    finally:
        engine.dispose()

    def graph():
        with sqlite3.connect(database) as db:
            return {
                name: (
                    db.execute(f'SELECT * FROM "{name}" ORDER BY id').fetchall(),
                    db.execute(f'PRAGMA foreign_key_list("{name}")').fetchall(),
                    db.execute(f'PRAGMA index_list("{name}")').fetchall(),
                )
                for name in fixture["tables"]
            }

    before = graph()
    command.upgrade(config, "head")
    assert graph() == before
    with sqlite3.connect(database) as db:
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
        assert db.execute("PRAGMA integrity_check").fetchone() == ("ok",)
    assert list(root.glob("test.db.bak-*"))
    env = ECEnv(root=root)
    empty = ECEnv(root=tmp_path / "empty")
    try:
        backup = empty.client.get("/api/export/backup").json()
        assert env.client.post("/api/import/cards", json=backup).status_code == 200
        # A compatible metadata downgrade keeps retired IDs, and re-upgrade
        # must not rebuild an already AUTOINCREMENT empty table and reset them.
        command.downgrade(config, "b1c2d3e4f502")
        command.upgrade(config, "head")
        env.restart()
        result = env.client.post("/api/cards/starter")
        assert result.status_code == 200, result.text
        cards = env.client.get("/api/cards").json()["cards"]
        assert cards and min(card["id"] for card in cards) > 202
    finally:
        env.close()
        empty.close()
