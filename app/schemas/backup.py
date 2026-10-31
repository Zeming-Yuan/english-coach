"""旧版部分恢复与 V2 全量快照的字段、身份和数据图校验。"""

from __future__ import annotations

import hashlib
import json
import math
from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.schemas.learning import Assistance, Kind, Source, Stage


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
            [
                {
                    "collection": "backup",
                    "index": "0",
                    "field": "?",
                    "reason": "必须是对象",
                }
            ]
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
            [
                {
                    "collection": "cards",
                    "index": "?",
                    "field": "id",
                    "reason": "源 ID 重复",
                }
            ]
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


# V2 rows mirror the explicit export whitelist. Every column is required, including
# nullable columns: an incomplete snapshot must never silently erase information.
class FullRow(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, strict=True)


class FullCard(FullRow):
    id: int = Field(gt=0, strict=True)
    word: str = Field(min_length=1)
    kind: Literal["word", "sentence"]
    phonetic: str | None
    meaning: str | None
    example: str | None
    example_cn: str | None
    explanation: str | None
    contexts: list | None
    related_words: list | None
    chunks: list | None
    difficulty: Literal["basic", "reading"] | None
    created_at: datetime


class FullReview(FullRow):
    id: int = Field(gt=0, strict=True)
    card_id: int = Field(gt=0, strict=True)
    state: int = Field(ge=0, le=3, strict=True)
    step: int | None = Field(ge=0)
    due: datetime
    stability: float | None = Field(ge=0)
    difficulty: float = Field(ge=0, le=10)
    elapsed_days: int = Field(ge=0, strict=True)
    last_review: datetime | None
    review_count: int = Field(ge=0, strict=True)
    rating: int | None = Field(ge=1, le=4)


class FullMemo(FullRow):
    id: int = Field(gt=0, strict=True)
    card_id: int = Field(gt=0, strict=True)
    content: str
    created_at: datetime


class FullError(FullRow):
    id: int = Field(gt=0, strict=True)
    card_id: int = Field(gt=0, strict=True)
    error_count: int = Field(ge=0, strict=True)
    last_error_at: datetime


class FullHard(FullRow):
    id: int = Field(gt=0, strict=True)
    card_id: int = Field(gt=0, strict=True)
    created_at: datetime


class FullLesson(FullRow):
    id: int = Field(gt=0, strict=True)
    level: int = Field(ge=1, strict=True)
    title: str
    content: dict
    created_at: datetime


class FullStory(FullRow):
    id: int = Field(gt=0, strict=True)
    title: str
    content: str
    content_cn: str | None
    title_cn: str | None
    created_at: datetime


class FullStoryWord(FullRow):
    id: int = Field(gt=0, strict=True)
    card_id: int = Field(gt=0, strict=True)
    story_id: int = Field(gt=0, strict=True)


class FullBaseline(FullRow):
    id: str
    card_id: int = Field(gt=0, strict=True)
    source_review_id: int | None = Field(gt=0)
    source_kind: Literal["migration", "legacy_import"]
    raw: dict
    selected: bool = Field(strict=True)
    captured_at: datetime
    last_activity: datetime | None
    cumulative_count: int = Field(ge=0, strict=True)
    source_fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")


class FullEvent(FullRow):
    id: str
    submission_id: str
    card_id: int = Field(gt=0, strict=True)
    source: Source
    kind: Kind
    stage: Stage
    occurred_at: datetime
    learning_day: str
    learning_timezone: str
    answer: str | None
    correct: bool | None = Field(strict=True)
    skipped: bool = Field(strict=True)
    scheduled: bool = Field(strict=True)
    assistance: list[Assistance]
    self_rating: int | None = Field(ge=1, le=4)
    fsrs_rating: int | None = Field(ge=1, le=4)
    before: dict | None
    after: dict | None
    fingerprint: str
    command_json: dict
    response: dict
    session_id: str | None


class FullBackup(FullRow):
    version: Literal[2]
    exported_at: datetime
    learning_timezone: str
    cards: list[FullCard]
    reviews: list[FullReview]
    learning_events: list[FullEvent]
    review_baselines: list[FullBaseline]
    memos: list[FullMemo]
    errors: list[FullError]
    hard_cards: list[FullHard]
    lessons: list[FullLesson]
    stories: list[FullStory]
    story_words: list[FullStoryWord]


def validate_backup(payload: dict) -> ValidatedBackup:
    if "version" not in payload:
        return validate_legacy_backup(payload)
    if type(payload["version"]) is not int or payload["version"] != 2:
        raise UnsupportedBackupError("未知备份版本")
    try:
        parsed = FullBackup.model_validate_json(json.dumps(payload))
    except ValidationError as error:
        issues = []
        for item in error.errors():
            loc = item["loc"]
            issues.append(
                {
                    "collection": str(loc[0]),
                    "index": str(loc[1]) if len(loc) > 1 else "?",
                    "field": ".".join(map(str, loc[2:])),
                    "reason": item["msg"],
                }
            )
        raise BackupValidationError(issues) from error
    tables = parsed.model_dump(exclude={"version", "exported_at", "learning_timezone"})
    _validate_full_graph(tables, payload)
    return ValidatedBackup(
        version=2, mode="full_replace", tables=tables, payload_digest=_digest(payload)
    )


def _validate_full_graph(tables: dict, payload: dict) -> None:
    from app.schemas.learning import AttemptCommand, AttemptResult
    from app.services.learning import canonical_attempt

    def reject(collection, index, field, reason):
        raise BackupValidationError(
            [
                {
                    "collection": collection,
                    "index": str(index),
                    "field": field,
                    "reason": reason,
                }
            ]
        )

    def timezone_valid(value):
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError, TypeError):
            return False
        return True

    def finite(value):
        if isinstance(value, float):
            return math.isfinite(value)
        if isinstance(value, dict):
            return all(finite(item) for item in value.values())
        if isinstance(value, list):
            return all(finite(item) for item in value)
        return True

    if not timezone_valid(payload["learning_timezone"]):
        reject("backup", 0, "learning_timezone", "未知学习时区")
    if not finite(payload):
        reject("backup", 0, "?", "数值必须有限")
    ids = {}
    for name, rows in tables.items():
        ids[name] = {row["id"] for row in rows}
        if len(ids[name]) != len(rows):
            reject(name, "?", "id", "源 ID 重复")
        for index, row in enumerate(rows):
            for field, parent in (("card_id", "cards"), ("story_id", "stories")):
                if field in row and row[field] not in {r["id"] for r in tables[parent]}:
                    reject(name, index, field, "引用了备份中不存在的实体")
    for name, key in (
        ("memos", "card_id"),
        ("hard_cards", "card_id"),
        ("lessons", "level"),
        ("learning_events", "submission_id"),
        ("review_baselines", "source_fingerprint"),
    ):
        values = [row[key] for row in tables[name]]
        if len(values) != len(set(values)):
            reject(name, "?", key, "唯一标识重复")
    for index, row in enumerate(tables["review_baselines"]):
        try:
            UUID(row["id"])
        except ValueError:
            reject("review_baselines", index, "id", "必须是 UUID")
    for index, row in enumerate(tables["learning_events"]):
        try:
            UUID(row["id"])
            UUID(row["submission_id"])
            if row["session_id"] is not None:
                UUID(row["session_id"])
            if (
                date.fromisoformat(row["learning_day"]).isoformat()
                != row["learning_day"]
            ):
                raise ValueError("invalid day")
            if not timezone_valid(row["learning_timezone"]):
                raise ValueError("未知学习时区")
            command_fields = set(AttemptCommand.model_fields) | {"question", "expected"}
            if set(row["command_json"]) != command_fields:
                raise ValueError("提交命令字段缺失或未知")
            if set(row["response"]) != set(AttemptResult.model_fields):
                raise ValueError("缓存结果字段缺失或未知")
            command = AttemptCommand.model_validate_json(
                json.dumps(row["command_json"]), strict=True
            )
            result = AttemptResult.model_validate_json(
                json.dumps(row["response"]), strict=True
            )
            expected = row["command_json"]["expected"]
            if expected is not None and not isinstance(expected, str):
                raise ValueError("已验答案必须是文本或空值")
            if result.next_due is not None:
                datetime.fromisoformat(result.next_due)
            for field in ("source", "kind", "stage", "answer", "skipped", "assistance"):
                if getattr(command, field) != row[field]:
                    raise ValueError("命令业务内容与事件不匹配")
            if result.correct != row["correct"] or result.scheduled != row["scheduled"]:
                raise ValueError("缓存业务结果与事件不匹配")
            for field in ("before", "after"):
                if row[field] is not None:
                    MemorySummary.model_validate_json(json.dumps(row[field]))
            if (
                canonical_attempt(
                    command, verified_question=row["command_json"].get("question")
                )
                != row["fingerprint"]
            ):
                raise ValueError("提交指纹与内容不匹配")
            if (
                command.card_id != row["card_id"]
                or str(command.submission_id) != row["submission_id"]
            ):
                raise ValueError("提交引用与事件不匹配")
            if result.card_id != row["card_id"] or result.event_id != row["id"]:
                raise ValueError("缓存结果与事件不匹配")
            if (
                result.sentence_card_id is not None
                and result.sentence_card_id not in ids["cards"]
            ):
                raise ValueError("缓存引用了不存在的卡")
            question = row["command_json"].get("question")
            if question is not None:
                if (
                    command.kind not in ("choice", "related")
                    or not isinstance(question, dict)
                    or set(question) != {"card_id", "kind", "options", "expected"}
                    or question.get("card_id") != row["card_id"]
                    or question.get("kind") != command.kind
                ):
                    raise ValueError("题目引用与事件不匹配")
                if (
                    not isinstance(question.get("options"), list)
                    or not all(
                        isinstance(option, str) for option in question["options"]
                    )
                    or question.get("expected") not in question["options"]
                ):
                    raise ValueError("题目选项无效")
        except (ValueError, TypeError, KeyError) as error:
            reject("learning_events", index, "command_json/response", str(error))


class MemorySummary(FullRow):
    state: int = Field(ge=0, le=3)
    step: int | None = Field(ge=0)
    due: datetime
    stability: float | None = Field(ge=0)
    difficulty: float | None = Field(ge=0, le=10)
    last_review: datetime | None
