"""EnglishCoach 应用入口。

启动：uvicorn app.main:app --reload
文档：http://localhost:8000/docs
"""

from fastapi import FastAPI

from app.routers import health

app = FastAPI(
    title="EnglishCoach",
    description="面向零基础英语学习者的 AI 个性化学习工具",
    version="0.1.0",
)

# 注册路由
app.include_router(health.router, prefix="/api", tags=["health"])
