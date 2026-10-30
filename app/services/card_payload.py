"""卡片载荷：卡片对外形状的单一来源。

三种形状，字段清单只在这里维护，其他路由不要再手写 card → dict 清单：
- queue_payload：今日队列载荷（轻量，无复习状态 → 零额外查询）
- card_payload：单词本列表/详情（含复习状态、毕业口径、错词/困难标记）
- backup_payload / card_from_backup：备份-导入（与数据库列同构，加字段自动生效）
"""

from datetime import datetime

from app.models.card import Card
from app.services.graduation import card_is_graduated


def queue_payload(card: Card) -> dict:
    """今日队列载荷（轻量：不含复习状态，避免逐卡查询）。"""
    return {
        "id": card.id,
        "word": card.word,
        "phonetic": card.phonetic,
        "meaning": card.meaning,
        "example": card.example,
        "example_cn": card.example_cn,
        "explanation": card.explanation,
        "contexts": card.contexts,
        "related_words": card.related_words,
        "kind": card.kind,
    }


def card_payload(
    card: Card,
    *,
    review=None,
    error=None,
    hard: bool = False,
) -> dict:
    """全量载荷：含复习状态（毕业口径 card_is_graduated，全库唯一）。"""
    return {
        "id": card.id,
        "word": card.word,
        "kind": card.kind,
        "phonetic": card.phonetic,
        "meaning": card.meaning,
        "example": card.example,
        "example_cn": card.example_cn,
        "explanation": card.explanation,
        "contexts": card.contexts,
        "related_words": card.related_words,
        "chunks": card.chunks,
        "difficulty": card.difficulty,
        "review_count": review.review_count if review else 0,
        "graduated": card_is_graduated(card, review),
        "error_count": error.error_count if error else 0,
        "is_hard": hard,
    }


def backup_payload(card: Card) -> dict:
    """备份载荷：与数据库列同构（含 JSON 列、created_at；加新列自动进备份）。"""
    payload = {}
    for col in Card.__table__.columns:
        value = getattr(card, col.key)
        if isinstance(value, datetime):
            value = value.isoformat()
        payload[col.key] = value
    return payload


def card_from_backup(d: dict) -> Card:
    """备份 dict → 新建 Card（导入用；id/created_at 由数据库重建）。"""
    field_names = Card.__table__.columns.keys()
    fields = {
        k: v for k, v in d.items() if k in field_names and k not in ("id", "created_at")
    }
    return Card(**fields)
