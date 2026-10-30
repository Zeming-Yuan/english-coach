"""追加式学习事件：每次被接受的学习提交保存一行，不覆盖历史。"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class ReviewEvent(Base):
    """一次学习提交的解释结果与排期摘要（只追加，不更新业务含义）。"""

    __tablename__ = "review_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    submission_id: Mapped[str] = mapped_column(
        String(36), unique=True, index=True, nullable=False
    )
    card_id: Mapped[int] = mapped_column(
        ForeignKey("cards.id", ondelete="CASCADE"), index=True, nullable=False
    )
    source: Mapped[str] = mapped_column(String(20), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    stage: Mapped[str] = mapped_column(
        String(20), nullable=False, default="standalone", server_default="standalone"
    )
    occurred_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    learning_day: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    learning_timezone: Mapped[str] = mapped_column(String(64), nullable=False)
    answer: Mapped[str | None] = mapped_column(Text, nullable=True)
    correct: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    skipped: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    scheduled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    assistance: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    self_rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fsrs_rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    before: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    after: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    command_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    response: Mapped[dict] = mapped_column(JSON, nullable=False)
    session_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
