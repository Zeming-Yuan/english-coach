"""Run an archived application on a test snapshot; never run old migrations."""

import argparse
import json
import os
import socket
import sqlite3
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive")
    parser.add_argument("--database")
    parser.add_argument("--snapshot-source")
    parser.add_argument("--snapshot-target")
    args = parser.parse_args()
    if args.snapshot_source:
        with (
            sqlite3.connect(
                f"file:{Path(args.snapshot_source).as_posix()}?mode=ro", uri=True
            ) as source,
            sqlite3.connect(args.snapshot_target) as target,
        ):
            source.backup(target)
        return
    archive = Path(args.archive)
    os.chdir(archive)
    sys.path.insert(0, str(archive))
    os.environ["DATABASE_URL"] = (
        f"sqlite:///file:{Path(args.database).as_posix()}?mode=ro&uri=true"
    )
    os.environ["LLM_API_KEY"] = "isolated-test-only"
    os.environ["LLM_BASE_URL"] = "http://127.0.0.1:9/v1"
    os.environ["DEEPSEEK_API_KEY"] = ""
    os.environ["DEEPSEEK_BASE_URL"] = ""
    # A successful external translation makes the real old GET attempt its write.
    # This replaces only the provider; all archived route/ORM logic remains real.
    from types import SimpleNamespace

    import uvicorn
    from starlette.responses import JSONResponse

    from app.main import app
    from app.routers import stories

    response = SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(
                    content=json.dumps(
                        {
                            "title_cn": "测试翻译",
                            "sentences": [{"cn": "固定测试译文。"}],
                        }
                    )
                )
            )
        ]
    )
    stories.client = SimpleNamespace(
        chat=SimpleNamespace(
            completions=SimpleNamespace(create=lambda **kwargs: response)
        )
    )

    from contextvars import ContextVar

    from sqlalchemy import event

    from app.db import engine

    violations = ContextVar("legacy_readonly_violations", default=None)

    @event.listens_for(engine, "handle_error")
    def record_readonly_write(context):
        if "readonly" in str(context.original_exception).lower():
            print("READ_ONLY_LEGACY_SQLITE_WRITE_BLOCKED", file=sys.stderr, flush=True)
            current = violations.get()
            if current is not None:
                current.append("SQLite refused an implicit write")

    class ReadOnlyLegacy:
        async def __call__(self, scope, receive, send):
            if scope["type"] == "http" and scope["method"] not in {
                "GET",
                "HEAD",
                "OPTIONS",
            }:
                await JSONResponse(
                    {"detail": "兼容模式只读；继续学习请使用当前后端"}, status_code=503
                )(scope, receive, send)
                return
            if scope["type"] != "http":
                await app(scope, receive, send)
                return
            blocked = []
            token = violations.set(blocked)
            messages = []

            async def collect(message):
                messages.append(message)

            try:
                await app(scope, receive, collect)
            except Exception:
                if not blocked:
                    raise
            finally:
                violations.reset(token)
            if blocked:
                await JSONResponse(
                    {"detail": "兼容模式只读：旧读取尝试写入；继续学习请使用当前后端"},
                    status_code=503,
                )(scope, receive, send)
            else:
                for message in messages:
                    await send(message)

    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    print(json.dumps({"port": port}), flush=True)
    uvicorn.run(ReadOnlyLegacy(), host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()
