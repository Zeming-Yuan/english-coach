"""旧复习数据的迁移基线：可追溯，但不是真实作答事件。"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class ReviewBaseline(Base):
    """升级前 Review 行的原始快照；selected 标记选中的当前状态来源行。"""

    __tablename__ = "review_baselines"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    card_id: Mapped[int] = mapped_column(
        ForeignKey("cards.id", ondelete="CASCADE"), index=True, nullable=False
    )
    source_review_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_kind: Mapped[str] = mapped_column(String(20), nullable=False)
    raw: Mapped[dict] = mapped_column(JSON, nullable=False)
    selected: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    captured_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    last_activity: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cumulative_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    source_fingerprint: Mapped[str] = mapped_column(
        String(64), unique=True, index=True, nullable=False
    )
