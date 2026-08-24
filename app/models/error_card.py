"""错词模型：答错的词加权优先重现（错误增强效应）。"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class ErrorCard(Base):
    """错词记录：error_count 越多权重越高，连续答对减权归零即删。"""

    __tablename__ = "error_cards"
    id: Mapped[int] = mapped_column(primary_key=True)
    card_id: Mapped[int] = mapped_column(
        ForeignKey("cards.id"), nullable=False, index=True
    )
    error_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    last_error_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
