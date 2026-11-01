"""课程学习状态：生成、显式浏览确认与后续检查计数。

生成一门课只是内容存在，不等于学习完成；浏览必须由用户显式确认。
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class LessonProgress(Base):
    """一门课程的生成/浏览状态；每课最多一行。"""

    __tablename__ = "lesson_progress"

    id: Mapped[int] = mapped_column(primary_key=True)
    lesson_id: Mapped[int] = mapped_column(
        ForeignKey("lessons.id", ondelete="CASCADE"),
        unique=True,
        index=True,
        nullable=False,
    )
    # 生成幂等身份；旧课程首次浏览也会得到一条记录，generated=False。
    generation_id: Mapped[str] = mapped_column(
        String(36), unique=True, index=True, nullable=False
    )
    generated: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1"
    )
    generated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    opened: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    opened_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    browsed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    browsed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    view_submission_id: Mapped[str | None] = mapped_column(
        String(36), unique=True, index=True, nullable=True
    )
    # 所有已确认的浏览提交；最新一条同时写入 view_submission_id。
    view_submissions: Mapped[list] = mapped_column(
        JSON, nullable=False, default=list, server_default="[]"
    )
    checked_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    passed_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
