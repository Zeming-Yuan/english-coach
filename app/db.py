"""数据库引擎与会话管理。

约定：所有路由通过 get_db 依赖获取会话，避免会话泄漏。
"""

import sqlite3
from collections.abc import Generator
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings


class Base(DeclarativeBase):
    """所有 ORM 模型的公共基类。"""


def sqlite_database_path(database_url: str) -> Path | None:
    """返回 SQLite 文件路径；内存库、只读 URI 与非 SQLite 地址返回 None。"""
    try:
        url = make_url(database_url)
    except Exception:  # noqa: BLE001 — 非法地址交给连接层报错
        return None
    if url.get_backend_name() != "sqlite" or not url.database:
        return None
    if url.database == ":memory:" or url.query.get("mode") == "ro":
        return None
    return Path(url.database)


def backup_sqlite_database(database_url: str) -> Path | None:
    """升级前用 SQLite backup API 建立可恢复副本，校验通过后才返回。

    只对已经包含业务表的 SQLite 文件库执行；全新空库无需备份。
    未打标（缺 alembic_version）的旧库也可能被升级流程检查，同样先备份。
    备份失败会抛 RuntimeError，调用方必须在迁移前停止。
    """
    db_path = sqlite_database_path(database_url)
    if db_path is None or not db_path.exists():
        return None
    try:
        source = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
    except sqlite3.Error as exc:
        raise RuntimeError(f"升级前无法读取数据库 {db_path}：{exc}") from exc
    try:
        has_tables = source.execute(
            "SELECT name FROM sqlite_master WHERE type='table' "
            "AND name NOT LIKE 'sqlite_%' LIMIT 1"
        ).fetchone()
        if has_tables is None:
            return None
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")
        target = db_path.with_name(f"{db_path.name}.bak-{stamp}")
        try:
            dest = sqlite3.connect(target)
            try:
                source.backup(dest)
                integrity = dest.execute("PRAGMA integrity_check").fetchone()
            finally:
                dest.close()
        except (sqlite3.Error, OSError) as exc:
            target.unlink(missing_ok=True)
            raise RuntimeError(
                f"无法创建升级前数据库备份 {target}，已停止迁移：{exc}"
            ) from exc
        if not integrity or integrity[0] != "ok":
            target.unlink(missing_ok=True)
            raise RuntimeError("升级前数据库备份完整性校验失败，已停止迁移。")
        return target
    finally:
        source.close()


def _make_engine():
    # SQLite 本地文件：先确保目录存在
    if settings.database_url.startswith("sqlite"):
        db_path = Path(settings.database_url.split("///")[-1])
        if str(db_path) != ":memory:":
            db_path.parent.mkdir(parents=True, exist_ok=True)
    return create_engine(
        settings.database_url,
        connect_args={"check_same_thread": False}
        if settings.database_url.startswith("sqlite")
        else {},
    )


engine = _make_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db() -> Generator[Session, None, None]:
    """FastAPI 依赖：提供数据库会话并保证用完即关。"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
