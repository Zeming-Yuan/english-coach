from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import JSON, DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

if TYPE_CHECKING:
    from app.models.story import Story


class Card(Base):
    """单词卡片"""

    __tablename__ = "cards"
    id: Mapped[int] = mapped_column(primary_key=True)
    word: Mapped[str] = mapped_column(String(50), nullable=False)
    phonetic: Mapped[str] = mapped_column(String(50), nullable=True)
    meaning: Mapped[str] = mapped_column(String(500), nullable=True)
    example: Mapped[str] = mapped_column(String(500), nullable=True)
    example_cn: Mapped[str] = mapped_column(String(500), nullable=True)
    contexts: Mapped[list | None] = mapped_column(JSON, nullable=True)
    kind: Mapped[str] = mapped_column(String(10), nullable=False, server_default="word")
    explanation: Mapped[str] = mapped_column(String(500), nullable=True)
    related_words: Mapped[list | None] = mapped_column(JSON, nullable=True)  # 词族/近义词
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    # 关联故事（多对多）
    stories: Mapped[list[Story]] = relationship(
        secondary="story_words", back_populates="cards"
    )
