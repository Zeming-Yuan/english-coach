"""Confirmed expansion selection, including replay after card deletion."""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class ExpansionAddition(Base):
    __tablename__ = "expansion_additions"

    id: Mapped[int] = mapped_column(primary_key=True)
    operation_id: Mapped[str] = mapped_column(String(36), unique=True, nullable=False)
    source_card_id: Mapped[int | None] = mapped_column(
        ForeignKey("cards.id", ondelete="SET NULL"), index=True
    )
    target_card_id: Mapped[int | None] = mapped_column(
        ForeignKey("cards.id", ondelete="SET NULL"), index=True
    )
    original_source_id: Mapped[int] = mapped_column(nullable=False)
    source_identity: Mapped[str] = mapped_column(String(36), nullable=False)
    source_version: Mapped[int] = mapped_column(nullable=False)
    target_identity: Mapped[str] = mapped_column(String(36), nullable=False)
    target_word: Mapped[str] = mapped_column(String(80), nullable=False)
    target_meaning: Mapped[str] = mapped_column(String(200), nullable=False)
    created: Mapped[bool] = mapped_column(Boolean, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
