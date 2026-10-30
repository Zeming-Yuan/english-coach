"""EnglishCoach 应用入口。

启动：uvicorn app.main:app --reload
文档：http://localhost:8000/docs
"""

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.config import Settings
from app.config import settings as app_settings
from app.routers import (
    cards,
    export,
    health,
    lessons,
    listening,
    lookup,
    memos,
    quiz,
    reviews,
    stories,
    today,
    tts,
)
from app.runtime import Runtime, SystemClock
from app.services.llm import configure_llm
from app.services.llm_client import LLMNotConfigured


def create_app(
    *,
    settings: Settings | None = None,
    runtime: Runtime | None = None,
    static_dir: Path | None = None,
) -> FastAPI:
    """构建应用；测试可注入配置、运行时和静态目录。"""
    settings = settings or app_settings
    runtime = runtime or Runtime(SystemClock(), settings.learning_timezone)
    configure_llm(settings)

    app = FastAPI(
        title="EnglishCoach",
        description="面向零基础英语学习者的 AI 个性化学习工具",
        version="0.1.0",
    )
    app.state.settings = settings
    app.state.runtime = runtime

    @app.exception_handler(LLMNotConfigured)
    async def _llm_not_configured(_request: Request, exc: LLMNotConfigured):
        """AI 未配置是可解释状态，不是服务器故障。"""
        return JSONResponse(status_code=503, content={"detail": str(exc)})

    # 注册路由
    app.include_router(health.router, prefix="/api", tags=["health"])
    app.include_router(today.router, prefix="/api", tags=["today"])
    app.include_router(reviews.router, prefix="/api", tags=["reviews"])
    app.include_router(quiz.router, prefix="/api", tags=["quiz"])
    app.include_router(stories.router, prefix="/api", tags=["stories"])
    app.include_router(cards.router, prefix="/api", tags=["cards"])
    app.include_router(tts.router, prefix="/api", tags=["tts"])
    app.include_router(lessons.router, prefix="/api", tags=["lessons"])
    app.include_router(listening.router, prefix="/api", tags=["listening"])
    app.include_router(memos.router, prefix="/api", tags=["memos"])
    app.include_router(export.router, prefix="/api", tags=["export"])
    app.include_router(lookup.router, prefix="/api", tags=["lookup"])

    # 前端静态文件（防缓存：开发期保证加载最新构建）
    # 绝对路径：从任意工作目录启动/请求都能找到构建产物
    static_dir = (static_dir or Path(__file__).resolve().parent / "static").resolve()
    app.mount(
        "/static",
        StaticFiles(directory=static_dir),
        name="static",
    )

    @app.get("/", include_in_schema=False)
    def index():
        """返回前端首页。"""
        return FileResponse(
            static_dir / "index.html",
            headers={"Cache-Control": "no-store"},
        )

    return app


app = create_app()
