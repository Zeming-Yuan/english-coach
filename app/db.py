"""数据库引擎与会话管理。

约定：所有路由通过 get_db 依赖获取会话，避免会话泄漏。
"""

from collections.abc import Generator
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings


class Base(DeclarativeBase):
    """所有 ORM 模型的公共基类。"""


def _make_engine():
    # SQLite 本地文件：先确保目录存在
    if settings.database_url.startswith("sqlite"):
        db_path = Path(settings.database_url.split("///")[-1])
        if str(db_path) != ":memory:":
            db_path.parent.mkdir(parents=True, exist_ok=True)
    return create_engine(
        settings.database_url,
        connect_args={"check_same_thread": False} if settings.database_url.startswith("sqlite") else {},
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
