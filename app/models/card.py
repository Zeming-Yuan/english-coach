from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Card(Base):
    """单词卡片"""

    __tablename__ = "cards"
    id: Mapped[int] = mapped_column(primary_key=True)
    word: Mapped[str] = mapped_column(String(50), nullable=False)
    phonetic: Mapped[str] = mapped_column(String(50), nullable=True)
    meaning: Mapped[str] = mapped_column(String(500), nullable=True)
    example: Mapped[str] = mapped_column(String(500), nullable=True)
    example_cn: Mapped[str] = mapped_column(String(500), nullable=True)
    explanation: Mapped[str] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
