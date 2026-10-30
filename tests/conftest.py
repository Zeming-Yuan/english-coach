"""pytest 公共夹具：每个测试用独立 SQLite 文件库，互不污染。"""

import os

# 测试进程自带占位配置：绝不读取真实密钥、不发起真实付费 AI 调用。
# 必须在导入 app 之前设置（环境变量优先于 .env）。
os.environ["LLM_API_KEY"] = ""
os.environ["LLM_BASE_URL"] = "http://127.0.0.1:9/v1"
os.environ.pop("DEEPSEEK_API_KEY", None)
os.environ.pop("DEEPSEEK_BASE_URL", None)

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import Base, get_db
from app.main import app
from app.models.card import Card
from tests.support.ec_env import ECEnv


@pytest.fixture()
def ec(tmp_path):
    """真实迁移数据库上的隔离应用环境。"""
    env = ECEnv(root=tmp_path / "ec")
    try:
        yield env
    finally:
        env.close()


@pytest.fixture()
def ec_factory(tmp_path):
    """创建多个互相独立数据库的 ECEnv（用于双实例恢复场景）。"""
    created: list[ECEnv] = []

    def factory() -> ECEnv:
        env = ECEnv(root=tmp_path / f"ec-{len(created)}")
        created.append(env)
        return env

    try:
        yield factory
    finally:
        for env in reversed(created):
            env.close()


@pytest.fixture()
def db_session(tmp_path):
    """独立文件库会话；请求 Session 与观察 Session 使用不同连接。"""
    db_path = tmp_path / "test.db"
    engine = create_engine(
        f"sqlite:///{db_path.as_posix()}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=engine)
    TestingSession = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = TestingSession()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


class _ObservingClient(TestClient):
    """每个请求使用新 Session；请求结束后让观察 Session 的缓存失效。"""

    observe_session = None

    def request(self, *args, **kwargs):
        try:
            return super().request(*args, **kwargs)
        finally:
            if self.observe_session is not None:
                # 学习写入由请求 Session 提交；观察 Session 需要重新读取。
                # Card 可能已被请求删除，保持其已加载状态避免无关的刷新错误。
                for obj in list(self.observe_session.identity_map.values()):
                    if not isinstance(obj, Card):
                        self.observe_session.expire(obj)


@pytest.fixture()
def client(db_session):
    """用测试数据库覆盖依赖的 TestClient（每请求独立 Session）。"""
    TestingSession = sessionmaker(
        bind=db_session.get_bind(), autoflush=False, autocommit=False
    )

    def override_get_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with _ObservingClient(app) as c:
        c.observe_session = db_session
        yield c
    app.dependency_overrides.clear()
