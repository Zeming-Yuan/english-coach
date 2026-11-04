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
    ai_config,
    cards,
    export,
    health,
    learning_advice,
    learning_observations,
    lessons,
    listening,
    lookup,
    memos,
    practice,
    quiz,
    reviews,
    sessions,
    stories,
    today,
    tts,
)
from app.runtime import Runtime, SystemClock
from app.services import ai_config_store
from app.services.llm import bind_llm_client, reset_llm_client
from app.services.llm_client import LazyLLMClient, LLMNotConfigured


def create_app(
    *,
    settings: Settings | None = None,
    runtime: Runtime | None = None,
    static_dir: Path | None = None,
) -> FastAPI:
    """构建应用；测试可注入配置、运行时和静态目录。"""
    settings = settings or app_settings
    # 设置页保存的配置优先于 .env，启动时加载。
    llm_config_path = Path(settings.llm_config_path)
    ai_config_store.load_into(settings, llm_config_path)
    runtime = runtime or Runtime(SystemClock(), settings.learning_timezone)

    app = FastAPI(
        title="EnglishCoach",
        description="面向零基础英语学习者的 AI 个性化学习工具",
        version="0.1.0",
    )
    runtime.scene_evidence_enabled = settings.scenes_enabled
    runtime.scene_expansions_enabled = settings.scene_expansions_enabled
    app.state.settings = settings
    app.state.runtime = runtime
    app.state.llm_config_path = llm_config_path
    app.state.llm_client = LazyLLMClient(settings)

    @app.middleware("http")
    async def _bind_request_llm(request: Request, call_next):
        """每个请求使用所属应用实例的 AI 配置，支持同进程多实例。"""
        token = bind_llm_client(request.app.state.llm_client)
        try:
            return await call_next(request)
        finally:
            reset_llm_client(token)

    @app.exception_handler(LLMNotConfigured)
    async def _llm_not_configured(_request: Request, exc: LLMNotConfigured):
        """AI 未配置是可解释状态，不是服务器故障。"""
        return JSONResponse(status_code=503, content={"detail": str(exc)})

    # 注册路由
    app.include_router(health.router, prefix="/api", tags=["health"])
    app.include_router(ai_config.router, prefix="/api", tags=["ai-config"])
    app.include_router(today.router, prefix="/api", tags=["today"])
    app.include_router(sessions.router, prefix="/api", tags=["sessions"])
    app.include_router(reviews.router, prefix="/api", tags=["reviews"])
    app.include_router(quiz.router, prefix="/api", tags=["quiz"])
    app.include_router(stories.router, prefix="/api", tags=["stories"])
    app.include_router(cards.router, prefix="/api", tags=["cards"])
    app.include_router(
        learning_observations.router, prefix="/api", tags=["learning-observations"]
    )
    app.include_router(tts.router, prefix="/api", tags=["tts"])
    app.include_router(lessons.router, prefix="/api", tags=["lessons"])
    app.include_router(listening.router, prefix="/api", tags=["listening"])
    app.include_router(memos.router, prefix="/api", tags=["memos"])
    app.include_router(export.router, prefix="/api", tags=["export"])
    app.include_router(lookup.router, prefix="/api", tags=["lookup"])
    app.include_router(learning_advice.router, prefix="/api", tags=["learning-advice"])
    app.include_router(practice.router, prefix="/api", tags=["practice"])

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
