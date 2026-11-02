"""Immutable checked story and operation identity; deletion leaves a tombstone."""

from sqlalchemy import JSON, Boolean, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class StoryVersion(Base):
    __tablename__ = "story_versions"

    id: Mapped[int] = mapped_column(primary_key=True)
    story_id: Mapped[int | None] = mapped_column(ForeignKey("stories.id"), unique=True)
    version_id: Mapped[str] = mapped_column(String(36), unique=True, nullable=False)
    operation_id: Mapped[str] = mapped_column(String(36), unique=True, nullable=False)
    include_new_target: Mapped[bool] = mapped_column(Boolean, nullable=False)
    story_identity: Mapped[str] = mapped_column(String(36), nullable=False)
    story_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    material: Mapped[dict] = mapped_column(JSON, nullable=False)
    quality: Mapped[dict] = mapped_column(JSON, nullable=False)
