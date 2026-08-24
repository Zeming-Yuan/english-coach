"""课程模型：AI 逐课生成的零基础学习单元。"""

from datetime import datetime

from sqlalchemy import JSON, DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Lesson(Base):
    """一课：AI 生成词表 + 对话，词落 cards 表复用学习流。"""

    __tablename__ = "lessons"
    id: Mapped[int] = mapped_column(primary_key=True)
    level: Mapped[int] = mapped_column(Integer, nullable=False, unique=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    # content: {"words": [...], "dialogue": [{"speaker", "en", "cn"}], "tips": [...]}
    content: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
