"""故事模型。"""
from __future__ import annotations
from datetime import datetime
from sqlalchemy import DateTime,ForeignKey,String,Text,func
from sqlalchemy.orm import Mapped,mapped_column,relationship

from app.db import Base

class Story(Base):
    """一篇 AI 生成的故事。"""
    __tablename__ = "stories"
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200),nullable=False)
    content: Mapped[str] = mapped_column(Text,nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime,nullable=False,server_default=func.now())
    # 关联词卡（多对多，通过 story_words）
    cards: Mapped[list["Card"]] = relationship(secondary="story_words",back_populates="stories")

class StoryWord(Base):
    """故事-词卡关联表（多对多）。"""
    __tablename__ = "story_words"
    id: Mapped[int] = mapped_column(primary_key=True)
    story_id: Mapped[int] = mapped_column(ForeignKey("stories.id"),index=True)
    card_id: Mapped[int] = mapped_column(ForeignKey("cards.id"),index=True)