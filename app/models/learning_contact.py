"""应用内接触记录：实际展示或播放后由服务端确认。

接触不是作答：不写学习事件、FSRS 排期、正确率、连续学习日或每日完成。
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class LearningContact(Base):
    """一次被服务端确认的应用内展示或播放。"""

    __tablename__ = "learning_contacts"

    id: Mapped[int] = mapped_column(primary_key=True)
    submission_id: Mapped[str] = mapped_column(
        String(36), unique=True, index=True, nullable=False
    )
    card_id: Mapped[int] = mapped_column(
        ForeignKey("cards.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # 展示时的内容修订；之后编辑不改变旧接触的归属。
    card_identity: Mapped[str] = mapped_column(String(36), nullable=False)
    card_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    source: Mapped[str] = mapped_column(String(20), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    # 服务端确认时间（naive UTC，与其他学习表一致）。
    occurred_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
