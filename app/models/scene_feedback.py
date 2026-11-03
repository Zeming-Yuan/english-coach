"""One immutable expression response per saved scene first answer."""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class SceneFeedback(Base):
    __tablename__ = "scene_feedback"

    id: Mapped[int] = mapped_column(primary_key=True)
    operation_id: Mapped[str] = mapped_column(String(36), unique=True, nullable=False)
    session_id: Mapped[str] = mapped_column(
        ForeignKey("practice_sessions.session_id", ondelete="CASCADE"), nullable=False
    )
    item_id: Mapped[str] = mapped_column(
        ForeignKey("practice_items.item_id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )
    attempt_id: Mapped[str] = mapped_column(
        ForeignKey("scene_attempts.attempt_id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )
    rule_version: Mapped[str] = mapped_column(String(30), nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    feedback_version: Mapped[str] = mapped_column(String(30), nullable=False)
    text: Mapped[str] = mapped_column(String(200), nullable=False)
    correction: Mapped[str | None] = mapped_column(String(500), nullable=True)
    origin: Mapped[str] = mapped_column(String(20), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
