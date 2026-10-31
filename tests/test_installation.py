"""EC-01：真实迁移链、配置迁移与无密钥启动。"""

import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text

from alembic import command

ROOT = Path(__file__).resolve().parents[1]
MIGRATION_HEAD = ScriptDirectory.from_config(
    Config(str(ROOT / "alembic.ini"))
).get_current_head()


def _migration_config(url: str) -> Config:
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", url)
    return config


def test_fresh_migration_contains_rating(tmp_path):
    url = f"sqlite:///{(tmp_path / 'fresh.db').as_posix()}"
    command.upgrade(_migration_config(url), "head")
    engine = create_engine(url)
    try:
        assert "rating" in {c["name"] for c in inspect(engine).get_columns("reviews")}
    finally:
        engine.dispose()


def test_stamped_missing_rating_repairs(tmp_path):
    """旧库已标记迁移完成但缺 rating 时仍能向前修复，且升级前留可恢复副本。"""
    db_path = tmp_path / "legacy.db"
    url = f"sqlite:///{db_path.as_posix()}"
    config = _migration_config(url)
    command.upgrade(config, "a9f3e7d1c2b4")

    engine = create_engine(url)
    try:
        assert "rating" not in {
            c["name"] for c in inspect(engine).get_columns("reviews")
        }
        with engine.begin() as conn:
            conn.execute(
                text("INSERT INTO cards (word, kind) VALUES ('apple', 'word')")
            )
            conn.execute(
                text(
                    "INSERT INTO reviews "
                    "(card_id, state, due, stability, difficulty, elapsed_days, review_count) "
                    "VALUES (1, 1, '2026-10-29 12:00:00', 2.5, 5.0, 1, 2)"
                )
            )
    finally:
        engine.dispose()

    command.upgrade(config, "head")

    engine = create_engine(url)
    try:
        assert "rating" in {c["name"] for c in inspect(engine).get_columns("reviews")}
        with engine.connect() as conn:
            assert conn.execute(text("SELECT word FROM cards")).scalar_one() == "apple"
            row = conn.execute(
                text("SELECT card_id, state, review_count FROM reviews")
            ).one()
            assert tuple(row) == (1, 1, 2)
            assert (
                conn.execute(
                    text("SELECT version_num FROM alembic_version")
                ).scalar_one()
                == MIGRATION_HEAD
            )
    finally:
        engine.dispose()

    backups = sorted(db_path.parent.glob("legacy.db.bak-*"))
    assert backups, "升级前应保留可恢复的数据库副本"
    with sqlite3.connect(backups[-1]) as conn:
        assert conn.execute("PRAGMA integrity_check").fetchone() == ("ok",)
    backup_engine = create_engine(f"sqlite:///{backups[-1].as_posix()}")
    try:
        assert "rating" not in {
            c["name"] for c in inspect(backup_engine).get_columns("reviews")
        }
    finally:
        backup_engine.dispose()

    # 重复执行已完成的升级不改变业务数据
    command.upgrade(config, "head")
    engine = create_engine(url)
    try:
        with engine.connect() as conn:
            assert conn.execute(text("SELECT COUNT(*) FROM cards")).scalar_one() == 1
            assert conn.execute(text("SELECT COUNT(*) FROM reviews")).scalar_one() == 1
            assert (
                conn.execute(text("SELECT review_count FROM reviews")).scalar_one() == 2
            )
    finally:
        engine.dispose()


def test_upgraded_database_accepts_a_review(tmp_path):
    """T03：升级后的旧库能真实提交一次学习并写回排期。"""
    db_path = tmp_path / "upgrade.db"
    url = f"sqlite:///{db_path.as_posix()}"
    config = _migration_config(url)
    command.upgrade(config, "a9f3e7d1c2b4")
    engine = create_engine(url)
    try:
        with engine.begin() as conn:
            conn.execute(
                text("INSERT INTO cards (word, kind) VALUES ('apple', 'word')")
            )
            conn.execute(
                text(
                    "INSERT INTO reviews "
                    "(card_id, state, step, due, stability, difficulty, elapsed_days, review_count) "
                    "VALUES (1, 1, 0, '2026-10-29 12:00:00', 2.5, 5.0, 0, 1)"
                )
            )
    finally:
        engine.dispose()

    command.upgrade(config, "head")

    from fastapi.testclient import TestClient
    from sqlalchemy.orm import sessionmaker

    from app.config import Settings
    from app.db import get_db
    from app.main import create_app
    from app.runtime import Runtime, SystemClock

    engine = create_engine(url, connect_args={"check_same_thread": False})
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    app = create_app(
        settings=Settings(_env_file=None, database_url=url, llm_api_key=""),
        runtime=Runtime(SystemClock()),
    )

    def override_get_db():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.post("/api/reviews", json={"card_id": 1, "rating": 1})
            assert response.status_code == 200, response.text
            assert response.json()["card_id"] == 1
            assert response.json()["next_due"]
    finally:
        engine.dispose()

    engine = create_engine(url)
    try:
        with engine.connect() as conn:
            rating, count = conn.execute(
                text("SELECT rating, review_count FROM reviews WHERE card_id = 1")
            ).one()
            assert (rating, count) == (1, 2)
    finally:
        engine.dispose()


def test_backup_covers_unstamped_database(tmp_path):
    """没有 alembic_version 的旧库升级前同样保留副本。"""
    from app.db import backup_sqlite_database

    db_path = tmp_path / "unstamped.db"
    with sqlite3.connect(db_path) as conn:
        conn.execute("CREATE TABLE cards (id INTEGER PRIMARY KEY, word TEXT)")
        conn.execute("INSERT INTO cards (word) VALUES ('apple')")

    backup = backup_sqlite_database(f"sqlite:///{db_path.as_posix()}")
    assert backup is not None
    assert backup.exists()
    with sqlite3.connect(backup) as conn:
        assert conn.execute("SELECT word FROM cards").fetchone() == ("apple",)


@pytest.mark.parametrize(
    ("env_update", "message"),
    [
        (
            {"LLM_API_KEY": "", "DEEPSEEK_API_KEY": "OLD_SECRET_DO_NOT_PRINT"},
            "LLM_API_KEY",
        ),
        (
            {"LLM_API_KEY": "NEW_SECRET_DO_NOT_PRINT", "DEEPSEEK_API_KEY": "old"},
            "冲突",
        ),
    ],
)
def test_legacy_configuration_explains_migration(env_update, message, tmp_path):
    """旧 DEEPSEEK 配置给出迁移说明；冲突报错；两种情况都不输出密钥。"""
    env = dict(os.environ, **env_update, PYTHONPATH=str(ROOT))
    result = subprocess.run(
        [sys.executable, "-c", "from app.config import settings"],
        env=env,
        cwd=tmp_path,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode != 0
    assert message in result.stderr
    assert "old" not in result.stderr
    assert "new" not in result.stderr
    assert "DO_NOT_PRINT" not in result.stderr


def _run_python(
    script: str, env: dict, cwd: Path = ROOT
) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-c", script],
        env=env,
        cwd=cwd,
        text=True,
        capture_output=True,
        check=False,
    )


def test_custom_database_target(tmp_path):
    """DATABASE_URL 与应用共用：迁移写到自定义地址而不是默认地址。"""
    custom_db = tmp_path / "custom.db"
    env = dict(
        os.environ,
        DATABASE_URL=f"sqlite:///{custom_db.as_posix()}",
        LLM_API_KEY="test-placeholder",
        PYTHONPATH=str(ROOT),
    )
    env["DEEPSEEK_API_KEY"] = ""
    env["DEEPSEEK_BASE_URL"] = ""
    script = (
        "from alembic import command\n"
        "from alembic.config import Config\n"
        "command.upgrade(Config('alembic.ini'), 'head')\n"
    )
    result = _run_python(script, env)
    assert result.returncode == 0, result.stderr

    engine = create_engine(f"sqlite:///{custom_db.as_posix()}")
    try:
        assert "rating" in {c["name"] for c in inspect(engine).get_columns("reviews")}
        with engine.connect() as conn:
            assert (
                conn.execute(
                    text("SELECT version_num FROM alembic_version")
                ).scalar_one()
                == MIGRATION_HEAD
            )
    finally:
        engine.dispose()


def test_explicit_migration_url_wins_over_settings(tmp_path):
    """测试显式设置的迁移地址优先，避免误写应用配置指向的数据库。"""
    target_db = tmp_path / "target.db"
    ignored_db = tmp_path / "ignored.db"
    env = dict(
        os.environ,
        DATABASE_URL=f"sqlite:///{ignored_db.as_posix()}",
        LLM_API_KEY="test-placeholder",
        PYTHONPATH=str(ROOT),
    )
    env["DEEPSEEK_API_KEY"] = ""
    env["DEEPSEEK_BASE_URL"] = ""
    script = (
        "from alembic import command\n"
        "from alembic.config import Config\n"
        "config = Config('alembic.ini')\n"
        f"config.set_main_option('sqlalchemy.url', 'sqlite:///{target_db.as_posix()}')\n"
        "command.upgrade(config, 'head')\n"
    )
    result = _run_python(script, env)
    assert result.returncode == 0, result.stderr
    assert target_db.exists()
    assert not ignored_db.exists()
    engine = create_engine(f"sqlite:///{target_db.as_posix()}")
    try:
        assert "rating" in {c["name"] for c in inspect(engine).get_columns("reviews")}
    finally:
        engine.dispose()


def test_readonly_database_reports_reason(tmp_path):
    """只读数据库升级失败时说明不可写，原数据保持不变。"""
    db_path = tmp_path / "readonly.db"
    normal_url = f"sqlite:///{db_path.as_posix()}"
    command.upgrade(_migration_config(normal_url), "a9f3e7d1c2b4")

    read_only_url = f"sqlite:///file:{db_path.as_posix()}?mode=ro&uri=true"
    with pytest.raises(RuntimeError) as excinfo:
        command.upgrade(_migration_config(read_only_url), "head")
    assert "不可写" in str(excinfo.value)

    engine = create_engine(normal_url)
    try:
        assert "rating" not in {
            c["name"] for c in inspect(engine).get_columns("reviews")
        }
    finally:
        engine.dispose()


def test_learning_timezone_must_be_iana():
    from pydantic import ValidationError

    from app.config import Settings

    assert Settings().learning_timezone == "Asia/Shanghai"
    with pytest.raises(ValidationError):
        Settings(learning_timezone="Not/AZone")


def test_missing_llm_key_serves_local_api_and_reports_503():
    """无密钥：非 AI 功能可用；AI 请求返回可识别的 503，而不是 502/崩溃。"""
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool

    from app.config import Settings
    from app.db import Base, get_db
    from app.main import create_app
    from app.runtime import Runtime, SystemClock

    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSession = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    try:
        app = create_app(
            settings=Settings(llm_api_key=""),
            runtime=Runtime(SystemClock()),
        )

        def override_get_db():
            db = TestingSession()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_get_db
        with TestClient(app, raise_server_exceptions=False) as client:
            assert client.get("/api/health").status_code == 200
            assert client.get("/api/today").status_code == 200
            response = client.post("/api/cards/generate", json={"words": ["apple"]})
            assert response.status_code == 503
            assert "LLM_API_KEY" in response.json()["detail"]
    finally:
        engine.dispose()


def test_static_assets_survive_working_directory_change(tmp_path, monkeypatch):
    """从其他工作目录请求时，首页与静态资源仍可访问（RF3）。"""
    from fastapi.testclient import TestClient

    from app.main import create_app

    client = TestClient(create_app())
    with client:
        monkeypatch.chdir(tmp_path)
        assert client.get("/").status_code == 200
        assert client.get("/static/style.css").status_code == 200
