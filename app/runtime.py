"""进程运行时：时钟与学习时区。

生产使用真实时间；测试通过 create_app(runtime=...) 注入可控时钟，
不提供任何可供日常请求修改时间的 HTTP 接口。
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Protocol
from zoneinfo import ZoneInfo

from fastapi import Request


class Clock(Protocol):
    """时钟接口：必须返回带时区的 UTC 时间。"""

    def now(self) -> datetime: ...


class SystemClock:
    """生产时钟：真实当前时间（aware UTC）。"""

    def now(self) -> datetime:
        return datetime.now(timezone.utc)


class Runtime:
    """一次应用运行的不可变环境：时钟 + 学习时区。"""

    def __init__(self, clock: Clock, learning_timezone: str = "Asia/Shanghai"):
        ZoneInfo(learning_timezone)  # 无效 IANA 名称直接失败，不以错误时区静默运行
        self.clock = clock
        self.learning_timezone = learning_timezone


def get_runtime(request: Request) -> Runtime:
    """FastAPI 依赖：从应用 state 读取运行时，避免跨实例全局时钟。"""
    return request.app.state.runtime
