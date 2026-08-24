"""记忆法模型：用户自己写的学习卡记忆法（自我解释效应）。"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Memo(Base):
    """用户为某张卡写的记忆法（谐音/联想/故事），复习时展示。"""

    __tablename__ = "memos"
    id: Mapped[int] = mapped_column(primary_key=True)
    card_id: Mapped[int] = mapped_column(
        ForeignKey("cards.id"), nullable=False, unique=True, index=True
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
