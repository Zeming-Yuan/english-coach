"""内容修订身份：实体当前的修订标识与版本。"""

from uuid import uuid4

from sqlalchemy import Integer, String, UniqueConstraint, event, insert
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.card import Card
from app.models.lesson import Lesson
from app.models.story import Story


class ContentRevision(Base):
    """一个可编辑实体（卡/课程/故事）的当前修订。

    identity 随实体恢复保留；version 只在词形、释义、例句或语境实质变化时递增。
    修改记忆法、音标或讲解不改变修订，因此不会让旧证据失去适用性。
    """

    __tablename__ = "content_revisions"
    __table_args__ = (
        UniqueConstraint(
            "resource_kind", "resource_id", name="uq_content_revisions_resource"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    resource_kind: Mapped[str] = mapped_column(String(10), nullable=False)
    resource_id: Mapped[int] = mapped_column(Integer, nullable=False)
    identity: Mapped[str] = mapped_column(String(36), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)


def _create_identity(resource_kind: str):
    """新实体在同一事务内获得初始修订身份。"""

    def listener(_mapper, connection, target) -> None:
        connection.execute(
            insert(ContentRevision).values(
                resource_kind=resource_kind,
                resource_id=target.id,
                identity=str(uuid4()),
                version=1,
            )
        )

    return listener


for _model, _kind in ((Card, "card"), (Lesson, "lesson"), (Story, "story")):
    event.listen(_model, "after_insert", _create_identity(_kind), propagate=True)
