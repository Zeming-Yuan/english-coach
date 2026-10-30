"""pytest 公共夹具：每个测试用独立的内存 SQLite，互不污染。"""

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
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.main import app
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
def db_session():
    """内存数据库会话（每个测试独立）。"""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSession = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = TestingSession()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


@pytest.fixture()
def client(db_session):
    """用测试数据库覆盖依赖的 TestClient。"""

    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
