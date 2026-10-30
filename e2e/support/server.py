"""E2E 隔离应用服务器：真实 FastAPI + 迁移库 + 测试控制文件。

控制文件只存在于测试临时目录，通过 --control-file 传入；生产应用没有读取
控制文件的路径。stdout 首行输出 {"port": ...} 供 Node 侧连接。
"""

from __future__ import annotations

import argparse
import json
import os
import socket
from pathlib import Path


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _load_fixture_payload(path: str | None) -> dict:
    if not path:
        return {}
    return json.loads(Path(path).read_text(encoding="utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", required=True)
    parser.add_argument("--static-dir", required=True)
    parser.add_argument("--control-file", required=True)
    parser.add_argument("--fixture")
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[2]
    payload = _load_fixture_payload(args.fixture)
    settings_payload = payload.get("settings") or {}
    external = payload.get("external") or {}

    # 必须在导入 app.main 之前固定隔离配置
    os.environ["DATABASE_URL"] = f"sqlite:///{Path(args.database).as_posix()}"
    os.environ["LLM_API_KEY"] = str(settings_payload.get("llm_api_key", ""))
    os.environ["LLM_BASE_URL"] = str(
        settings_payload.get("llm_base_url", "http://127.0.0.1:9/v1")
    )
    os.environ["EC_EXTERNAL_LLM"] = str(external.get("llm", ""))
    # 空值覆盖用户 .env 中的旧配置，测试服务器不读取真实密钥
    os.environ["DEEPSEEK_API_KEY"] = ""
    os.environ["DEEPSEEK_BASE_URL"] = ""
    if str(root) not in os.sys.path:
        os.sys.path.insert(0, str(root))

    import uvicorn
    from sqlalchemy import event
    from sqlalchemy.orm import Session

    from app.config import Settings
    from app.main import create_app
    from app.runtime import Runtime
    from tests.support.ec_env import MutableClock

    control_file = Path(args.control_file)

    @event.listens_for(Session, "before_commit")
    def _maybe_fail_commit(_session) -> None:
        try:
            control = json.loads(control_file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return
        if control.get("fail_commit_once"):
            control["fail_commit_once"] = False
            control_file.write_text(json.dumps(control), encoding="utf-8")
            raise OSError("injected commit failure")

    settings = Settings()
    runtime = Runtime(
        MutableClock(control_file=control_file), settings.learning_timezone
    )
    app = create_app(
        settings=settings,
        runtime=runtime,
        static_dir=Path(args.static_dir),
    )

    port = _free_port()
    print(json.dumps({"port": port, "databasePath": args.database}), flush=True)
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()
