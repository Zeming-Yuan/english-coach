from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Review(Base):
    """复习记录"""

    __tablename__ = "reviews"
    id: Mapped[int] = mapped_column(primary_key=True)
    card_id: Mapped[int] = mapped_column(ForeignKey("cards.id"), index=True)
    state: Mapped[int] = mapped_column(nullable=False)
    due: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    stability: Mapped[float] = mapped_column(Float)
    difficulty: Mapped[float] = mapped_column(Float, nullable=False)
    elapsed_days: Mapped[int] = mapped_column(Integer, nullable=False)
    last_review: Mapped[datetime | None] = mapped_column(DateTime)
    review_count: Mapped[int] = mapped_column(Integer, nullable=False)
