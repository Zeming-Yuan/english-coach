"""隔离的 HTTP 测试环境（ECEnv）。

数据库在测试临时目录中，通过真实 Alembic 迁移建立；应用使用真实 FastAPI，
仅外部 AI 调用保持未配置/可替换。可注入时钟与一次性提交故障，供后续票据复用。
"""

from __future__ import annotations

import json
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from alembic import command
from app.config import Settings
from app.db import get_db
from app.main import create_app
from app.models.card import Card
from app.runtime import Runtime

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_NOW = "2026-10-30T12:00:00+00:00"


def _aware_utc(value: str | datetime) -> datetime:
    if isinstance(value, datetime):
        parsed = value
    else:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


class MutableClock:
    """测试时钟：默认返回固定 aware UTC；可显式改时间或读取控制文件。

    control_file 仅由 E2E 测试服务器使用，生产 Runtime 不读取任何控制文件。
    """

    def __init__(
        self,
        initial: str | datetime | None = None,
        control_file: Path | None = None,
    ):
        self._now = _aware_utc(initial or DEFAULT_NOW)
        self._control_file = control_file

    def now(self) -> datetime:
        if self._control_file is not None:
            try:
                payload = json.loads(self._control_file.read_text(encoding="utf-8"))
                if "now" in payload:
                    return _aware_utc(payload["now"])
            except (OSError, ValueError):
                pass
        return self._now

    def set(self, iso: str) -> None:
        self._now = _aware_utc(iso)


class ECEnv:
    """一次隔离应用实例：迁移库 + 真实 TestClient + 测试用控制能力。"""

    def __init__(
        self,
        *,
        root: Path | None = None,
        settings: Settings | None = None,
        clock: MutableClock | None = None,
    ):
        if root is None:
            self.root = Path(tempfile.mkdtemp(prefix="ec-env-"))
        else:
            self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.database_path = self.root / "test.db"
        self.database_url = f"sqlite:///{self.database_path.as_posix()}"
        self.settings = settings or Settings(
            _env_file=None,
            database_url=self.database_url,
            llm_api_key="",
            llm_base_url="http://127.0.0.1:9/v1",
            deepseek_api_key="",
            deepseek_base_url="",
        )
        self.clock = clock or MutableClock()
        self.runtime = Runtime(self.clock, self.settings.learning_timezone)
        self._migrate()
        self.engine = create_engine(
            self.database_url,
            connect_args={"check_same_thread": False},
        )
        self._fail_next_commit = False

        class EnvSession(Session):
            """只属于本环境的 Session：故障监听不污染其他实例。"""

        event.listen(EnvSession, "before_commit", self._before_commit)
        self.SessionLocal = sessionmaker(
            bind=self.engine, class_=EnvSession, autoflush=False, autocommit=False
        )
        self.app = self._build_app()
        self.client = TestClient(self.app, raise_server_exceptions=False)

    def _migrate(self) -> None:
        config = Config(str(ROOT / "alembic.ini"))
        config.set_main_option("sqlalchemy.url", self.database_url)
        command.upgrade(config, "head")

    def _before_commit(self, session: Session) -> None:
        if self._fail_next_commit:
            self._fail_next_commit = False
            raise OSError("injected commit failure")

    def _session(self) -> Session:
        return self.SessionLocal()

    def _get_db(self):
        db = self._session()
        try:
            yield db
        finally:
            db.close()

    def _build_app(self):
        app = create_app(
            settings=self.settings,
            runtime=self.runtime,
            static_dir=ROOT / "app" / "static",
        )
        app.dependency_overrides[get_db] = self._get_db
        return app

    def seed_card(self, word: str = "apple", kind: str = "word", **fields: Any) -> int:
        """用真实 Card 模型创建测试前置数据并返回真实 ID。"""
        payload: dict[str, Any] = {
            "meaning": "苹果",
            "example": None,
            "example_cn": None,
        }
        payload.update(fields)
        db = self._session()
        try:
            card = Card(word=word, kind=kind, **payload)
            db.add(card)
            db.commit()
            db.refresh(card)
            return card.id
        finally:
            db.close()

    def set_time(self, iso: str) -> None:
        self.clock.set(iso)

    def fail_commit_once(self) -> None:
        """让下一次实际写事务的 before_commit 抛 OSError（先完成 seed 再启用）。"""
        self._fail_next_commit = True

    def snapshot(self) -> dict:
        """业务语义快照：走完整备份接口，只剔除导出时间，供恢复行为比较。"""
        payload = self.client.get("/api/export/backup").json()
        payload.pop("exported_at", None)
        return payload

    def restart(self) -> None:
        """在同一数据库上重建应用与客户端，保留时钟与已落库数据。

        题目签名密钥随 Runtime 重新生成，模拟进程重启后旧 token 失效。
        """
        self.client.close()
        self.runtime = Runtime(self.clock, self.settings.learning_timezone)
        self.app = self._build_app()
        self.client = TestClient(self.app, raise_server_exceptions=False)

    def close(self) -> None:
        try:
            self.client.close()
        finally:
            self.engine.dispose()
            shutil.rmtree(self.root, ignore_errors=True)
