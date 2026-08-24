"""EnglishCoach 应用入口。

启动：uvicorn app.main:app --reload
文档：http://localhost:8000/docs
"""

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.routers import cards, health, quiz, reviews, stories, today, tts

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

# 前端静态文件
app.mount("/static", StaticFiles(directory="app/static"), name="static")


@app.get("/", include_in_schema=False)
def index():
    """返回前端首页。"""
    return FileResponse(Path("app/static/index.html"))
