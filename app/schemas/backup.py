"""备份格式：旧版（version 缺失）字段的严格校验模型。"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError


class BackupValidationError(ValueError):
    """备份内容不合法；detail 指出集合、记录与字段。"""

    def __init__(self, issues: list[dict[str, str]]):
        self.issues = issues
        super().__init__("备份内容不合法")


class UnsupportedBackupError(ValueError):
    """当前版本尚不支持该备份格式。"""


class LegacyCard(BaseModel):
    model_config = ConfigDict(extra="ignore", allow_inf_nan=False)

    id: int
    word: str = Field(min_length=1)
    kind: Literal["word", "sentence"] = "word"
    phonetic: str | None = None
    meaning: str | None = None
    example: str | None = None
    example_cn: str | None = None
    explanation: str | None = None
    contexts: Any = None
    related_words: Any = None
    chunks: Any = None
    difficulty: str | None = None
    created_at: datetime | None = None


class LegacyReview(BaseModel):
    model_config = ConfigDict(extra="ignore", allow_inf_nan=False)

    card_id: int
    state: int = Field(ge=0, le=3)
    step: int | None = None
    due: datetime | None = None
    stability: float | None = Field(default=None, ge=0)
    difficulty: float | None = Field(default=None, ge=0)
    elapsed_days: int = Field(default=0, ge=0)
    last_review: datetime | None = None
    review_count: int = Field(default=1, ge=0)
    rating: int | None = Field(default=None, ge=1, le=4)


class LegacyMemo(BaseModel):
    model_config = ConfigDict(extra="ignore")

    card_id: int
    content: str = Field(min_length=1)


class LegacyError(BaseModel):
    model_config = ConfigDict(extra="ignore", allow_inf_nan=False)

    card_id: int
    error_count: int = Field(default=1, ge=1)


class LegacyBackup(BaseModel):
    model_config = ConfigDict(extra="ignore")

    cards: list[LegacyCard] = Field(default_factory=list)
    reviews: list[LegacyReview] = Field(default_factory=list)
    memos: list[LegacyMemo] = Field(default_factory=list)
    errors: list[LegacyError] = Field(default_factory=list)


class ValidatedBackup(BaseModel):
    """校验后的备份：模式、集合与内容摘要。"""

    version: Literal[1, 2]
    mode: Literal["legacy_partial", "full_replace"]
    tables: dict[str, list[dict]]
    payload_digest: str


def _issues_from_error(error: ValidationError, collection: str) -> list[dict[str, str]]:
    issues = []
    for item in error.errors():
        location = [str(part) for part in item["loc"]]
        issues.append(
            {
                "collection": collection,
                "index": location[0] if location else "?",
                "field": ".".join(location[1:]) or "?",
                "reason": item["msg"],
            }
        )
    return issues


def _digest(payload: dict) -> str:
    encoded = json.dumps(
        payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=str
    )
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def validate_legacy_backup(payload: dict) -> ValidatedBackup:
    """校验旧版备份；任何非法字段在写入前拒绝。"""
    if payload.get("version") == 2:
        raise UnsupportedBackupError("新版全量恢复将在后续版本提供")
    if not isinstance(payload, dict):
        raise BackupValidationError(
            [{"collection": "backup", "index": "0", "field": "?", "reason": "必须是对象"}]
        )

    issues: list[dict[str, str]] = []
    parsed: dict[str, list[BaseModel]] = {}
    for collection, model in (
        ("cards", LegacyCard),
        ("reviews", LegacyReview),
        ("memos", LegacyMemo),
        ("errors", LegacyError),
    ):
        rows = payload.get(collection) or []
        if not isinstance(rows, list):
            issues.append(
                {
                    "collection": collection,
                    "index": "0",
                    "field": "?",
                    "reason": "必须是数组",
                }
            )
            continue
        try:
            parsed[collection] = [model.model_validate(row) for row in rows]
        except ValidationError as error:
            issues.extend(_issues_from_error(error, collection))

    if issues:
        raise BackupValidationError(issues)

    cards = parsed["cards"]
    source_ids = [card.id for card in cards]
    if len(source_ids) != len(set(source_ids)):
        raise BackupValidationError(
            [{"collection": "cards", "index": "?", "field": "id", "reason": "源 ID 重复"}]
        )
    source_id_set = set(source_ids)
    for collection in ("reviews", "memos", "errors"):
        for index, row in enumerate(parsed[collection]):
            if row.card_id not in source_id_set:
                raise BackupValidationError(
                    [
                        {
                            "collection": collection,
                            "index": str(index),
                            "field": "card_id",
                            "reason": "引用了备份中不存在的卡",
                        }
                    ]
                )

    return ValidatedBackup(
        version=1,
        mode="legacy_partial",
        tables={
            collection: [row.model_dump(exclude_unset=True) for row in rows]
            for collection, rows in parsed.items()
        },
        payload_digest=_digest(payload),
    )
