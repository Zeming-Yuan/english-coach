"""内容修订：实体身份与语义版本。

词卡：word/meaning/example/example_cn/contexts；课程：title/content；
故事：title/content/title_cn/content_cn 的实质变化增加版本。
纯排版差异（空白、换行）不算变化，记忆法/音标/讲解也不改变词卡修订。
"""

from __future__ import annotations

from uuid import uuid4

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.card import Card
from app.models.content_revision import ContentRevision
from app.models.lesson import Lesson
from app.models.story import Story

RESOURCE_MODELS = {"card": Card, "lesson": Lesson, "story": Story}
CARD_SEMANTIC_FIELDS = frozenset(
    {"word", "meaning", "example", "example_cn", "contexts"}
)
SEMANTIC_FIELDS_BY_KIND = {
    "card": CARD_SEMANTIC_FIELDS,
    "lesson": frozenset({"title", "content"}),
    "story": frozenset({"title", "content", "title_cn", "content_cn"}),
}
# 兼容既有词卡规则测试与 next_revision 默认参数。
SEMANTIC_FIELDS = CARD_SEMANTIC_FIELDS


class UnknownResourceKindError(ValueError):
    """修订资源类型不在 card/lesson/story 之内。"""


def semantic_value(value):
    """归一化语义内容：折叠字符串空白，递归处理列表与对象。"""
    if isinstance(value, str):
        return " ".join(value.split())
    if isinstance(value, list):
        return [semantic_value(item) for item in value]
    if isinstance(value, dict):
        return {key: semantic_value(item) for key, item in value.items()}
    return value


def next_revision(
    before: dict, changes: dict, current: int, fields=SEMANTIC_FIELDS
) -> int:
    """返回下一修订号；没有语义变化时保持 current。"""
    changed = any(
        key in fields
        and semantic_value(before.get(key)) != semantic_value(value)
        for key, value in changes.items()
    )
    return current + int(changed)


def _model(resource_kind: str):
    try:
        return RESOURCE_MODELS[resource_kind]
    except KeyError as error:
        raise UnknownResourceKindError(f"未知资源类型：{resource_kind}") from error


def _new_revision(resource_kind: str, resource_id: int) -> ContentRevision:
    return ContentRevision(
        resource_kind=resource_kind,
        resource_id=resource_id,
        identity=str(uuid4()),
        version=1,
    )


def _revision_row(
    db: Session, resource_kind: str, resource_id: int
) -> ContentRevision | None:
    return db.execute(
        select(ContentRevision).where(
            ContentRevision.resource_kind == resource_kind,
            ContentRevision.resource_id == resource_id,
        )
    ).scalars().first()


def ensure_content_revisions(db: Session) -> None:
    """为缺少修订身份的现有实体补齐身份；不写学习事件，不改版本。"""
    # Pending rows (e.g. restored extensions) must be visible to the queries
    # below, otherwise the same entity would be inserted twice.
    db.flush()
    for resource_kind, model in RESOURCE_MODELS.items():
        known = set(
            db.scalars(
                select(ContentRevision.resource_id).where(
                    ContentRevision.resource_kind == resource_kind
                )
            )
        )
        for resource_id in db.scalars(select(model.id)):
            if resource_id not in known:
                db.add(_new_revision(resource_kind, resource_id))
    db.flush()


def get_content_revision(
    db: Session, resource_kind: str, resource_id: int
) -> dict:
    """读取当前修订。实体创建、迁移和恢复都会初始化身份；缺失即数据异常。"""
    _model(resource_kind)
    row = _revision_row(db, resource_kind, resource_id)
    if row is None:
        raise LookupError(f"缺少内容修订身份：{resource_kind}:{resource_id}")
    return {"identity": row.identity, "version": row.version}


def lesson_word_cards(db: Session, lesson: Lesson) -> list[dict]:
    """课程词表对应的真实词卡与修订；没有词卡的目标不伪造。"""
    words = lesson.content.get("words", [])
    names = [word.get("word") for word in words if word.get("word")]
    cards = (
        db.execute(
            select(Card).where(Card.kind == "word", Card.word.in_(names))
        )
        .scalars()
        .all()
    )
    by_word = {}
    for card in cards:
        by_word.setdefault(card.word, card)
    revisions = content_revision_map(db, "card", [card.id for card in cards])
    result = []
    for word in words:
        card = by_word.get(word.get("word"))
        if card is None:
            continue
        result.append(
            {
                "id": card.id,
                "word": card.word,
                "phonetic": word.get("phonetic") or card.phonetic,
                "meaning": word.get("meaning") or card.meaning,
                "content_revision": revisions[card.id],
            }
        )
    return result


def content_revision_map(
    db: Session, resource_kind: str, resource_ids
) -> dict[int, dict]:
    """批量读取当前修订；每次调用只发一次查询。"""
    ids = list(dict.fromkeys(resource_ids))
    if not ids:
        return {}
    return {
        row.resource_id: {"identity": row.identity, "version": row.version}
        for row in db.execute(
            select(ContentRevision).where(
                ContentRevision.resource_kind == resource_kind,
                ContentRevision.resource_id.in_(ids),
            )
        ).scalars()
    }


def delete_content_revision(db: Session, resource_kind: str, resource_id: int) -> None:
    """实体删除时同步移除修订身份，避免备份出现悬空引用。"""
    db.execute(
        delete(ContentRevision).where(
            ContentRevision.resource_kind == resource_kind,
            ContentRevision.resource_id == resource_id,
        )
    )


def advance_content_revision(
    db: Session, resource_kind: str, resource_id: int, changes: dict
) -> dict:
    """在调用方修改实体前计算并保存新修订（同一事务）。"""
    model = _model(resource_kind)
    entity = db.get(model, resource_id)
    if entity is None:
        raise LookupError(f"{resource_kind}:{resource_id} 不存在")
    fields = SEMANTIC_FIELDS_BY_KIND[resource_kind]
    before = {
        key: getattr(entity, key, None) for key in fields if hasattr(entity, key)
    }
    row = _revision_row(db, resource_kind, resource_id)
    if row is None:
        row = _new_revision(resource_kind, resource_id)
        db.add(row)
    row.version = next_revision(before, changes, row.version, fields)
    db.flush()
    return {"identity": row.identity, "version": row.version}
