"""持久练习上下文：一轮短测及其冻结题目。

轮次与题目只引用真实学习事件作为结果，不复制或改写成绩。
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class PracticeSession(Base):
    """一轮练习：用途、生命周期与结果状态分开保存。"""

    __tablename__ = "practice_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    # 客户端提供的稳定轮次标识；同一标识重放返回同一轮。
    session_id: Mapped[str] = mapped_column(
        String(36), unique=True, index=True, nullable=False
    )
    purpose: Mapped[str] = mapped_column(String(30), nullable=False)
    weak_only: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    targets_explicit: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    lesson_id: Mapped[int | None] = mapped_column(
        ForeignKey("lessons.id", ondelete="CASCADE"), index=True, nullable=True
    )
    version_id: Mapped[str | None] = mapped_column(
        ForeignKey("story_versions.version_id"), nullable=True, index=True
    )
    scene_id: Mapped[str | None] = mapped_column(String(30), nullable=True)
    scene_snapshot: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Local ownership token; full restore always issues a fresh one.
    feedback_epoch: Mapped[str | None] = mapped_column(String(36), nullable=True)
    # active | completed | unavailable
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    rule_version: Mapped[str] = mapped_column(
        String(20), nullable=False, default="el08-v1"
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    window: Mapped[str | None] = mapped_column(String(10), nullable=True)
    pending_contact_ids: Mapped[list] = mapped_column(
        JSON, nullable=False, default=list, server_default="[]"
    )


class PracticeItem(Base):
    """一轮中的一道冻结题目；首答结果关联真实学习事件。"""

    __tablename__ = "practice_items"
    __table_args__ = (
        UniqueConstraint("session_id", "position", name="uq_practice_item_position"),
        UniqueConstraint(
            "session_id", "card_id", "kind", name="uq_practice_item_card_kind"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[str] = mapped_column(
        String(36), unique=True, index=True, nullable=False
    )
    session_id: Mapped[str] = mapped_column(
        ForeignKey("practice_sessions.session_id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    card_id: Mapped[int | None] = mapped_column(
        ForeignKey("cards.id", ondelete="CASCADE"), index=True, nullable=True
    )
    card_identity: Mapped[str | None] = mapped_column(String(36), nullable=True)
    card_revision: Mapped[int | None] = mapped_column(Integer, nullable=True)
    prompt: Mapped[str] = mapped_column(String(500), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False, default="typed")
    question: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    assistance: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    first_event_id: Mapped[str | None] = mapped_column(
        String(36), unique=True, index=True, nullable=True
    )
    first_task_attempt_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    retention_basis: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    retention_result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
