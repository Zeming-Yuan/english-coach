"""Append-only scene responses; first response stays on the practice item."""

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class SceneAttempt(Base):
    __tablename__ = "scene_attempts"

    id: Mapped[int] = mapped_column(primary_key=True)
    attempt_id: Mapped[str] = mapped_column(String(36), unique=True, nullable=False)
    submission_id: Mapped[str] = mapped_column(String(36), unique=True, nullable=False)
    session_id: Mapped[str] = mapped_column(
        ForeignKey("practice_sessions.session_id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    item_id: Mapped[str] = mapped_column(
        ForeignKey("practice_items.item_id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    answer: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    skipped: Mapped[bool] = mapped_column(Boolean, nullable=False)
    assistance: Mapped[list] = mapped_column(JSON, nullable=False)
    verdict: Mapped[str] = mapped_column(String(20), nullable=False)
    task_key: Mapped[str] = mapped_column(String(30), nullable=False)
    rule_version: Mapped[str] = mapped_column(String(30), nullable=False)
    target_mapping: Mapped[list] = mapped_column(JSON, nullable=False)
    fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    command_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    response: Mapped[dict] = mapped_column(JSON, nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
