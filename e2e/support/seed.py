"""E2E 测试数据准备：迁移隔离库并可选载入 fixture / 卡片。

仅测试支持使用；生产不注册任何调试端点。
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path


def _database_url(path: str) -> str:
    return f"sqlite:///{Path(path).as_posix()}"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", required=True)
    parser.add_argument("--fixture")
    parser.add_argument("--cards-file")
    parser.add_argument("--migrate", action="store_true")
    args = parser.parse_args()

    url = _database_url(args.database)
    # 导入应用配置前固定隔离值；空值覆盖用户 .env，不读取真实密钥
    os.environ["DATABASE_URL"] = url
    os.environ["LLM_API_KEY"] = ""
    os.environ["LLM_BASE_URL"] = "http://127.0.0.1:9/v1"
    os.environ["DEEPSEEK_API_KEY"] = ""
    os.environ["DEEPSEEK_BASE_URL"] = ""

    from sqlalchemy import create_engine

    from app import models  # noqa: F401 — 注册全部模型表
    from e2e.support.fixture_loader import load_fixture

    if args.migrate:
        from alembic.config import Config

        from alembic import command

        root = Path(__file__).resolve().parents[2]
        config = Config(str(root / "alembic.ini"))
        config.set_main_option("sqlalchemy.url", url)
        command.upgrade(config, "head")

    engine = create_engine(url)
    try:
        if args.fixture:
            payload = json.loads(Path(args.fixture).read_text(encoding="utf-8"))
            load_fixture(engine, payload)
        if args.cards_file:
            cards = json.loads(Path(args.cards_file).read_text(encoding="utf-8"))
            rows = [{"meaning": "苹果", "kind": "word", **card} for card in cards]
            load_fixture(engine, {"tables": {"cards": rows}})
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
