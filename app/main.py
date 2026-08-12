"""EnglishCoach 应用入口。

启动：uvicorn app.main:app --reload
文档：http://localhost:8000/docs
"""

from fastapi import FastAPI

from app.routers import health, quiz, reviews, today

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
