"""Append-only active workload observations; never learning evidence."""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class PracticeDuration(Base):
    __tablename__ = "practice_durations"

    id: Mapped[int] = mapped_column(primary_key=True)
    sample_id: Mapped[str] = mapped_column(String(36), unique=True, nullable=False)
    submission_id: Mapped[str] = mapped_column(
        ForeignKey("review_events.submission_id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    active_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    rule_version: Mapped[str] = mapped_column(String(32), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
