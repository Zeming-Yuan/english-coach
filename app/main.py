"""EnglishCoach 应用入口。

启动：uvicorn app.main:app --reload
文档：http://localhost:8000/docs
"""

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

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

app = FastAPI(
    title="EnglishCoach",
    description="面向零基础英语学习者的 AI 个性化学习工具",
    version="0.1.0",
)

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
app.mount(
    "/static",
    StaticFiles(directory="app/static"),
    name="static",
)


@app.get("/", include_in_schema=False)
def index():
    """返回前端首页。"""
    return FileResponse(
        Path("app/static/index.html"),
        headers={"Cache-Control": "no-store"},
    )
