"""V3 完整备份：显式登记扩展集合、校验并映射恢复。

V3 在 V2 核心集合之外增加 features 与 extensions。每个扩展集合必须先在本
模块登记 schema、父引用与 ID 重映射，导出、校验和恢复共享同一份登记；
未知功能拒绝恢复，避免静默丢数据。
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, NoReturn, cast
from uuid import UUID

from pydantic import BaseModel, Field, ValidationError, field_validator

from app.models.content_revision import ContentRevision
from app.models.learning_contact import LearningContact
from app.models.lesson_progress import LessonProgress
from app.schemas.backup import (
    BackupValidationError,
    FullBackup,
    FullEvent,
    FullRow,
    ValidatedBackup,
    _digest,
    _issues_from_error,
)
from app.schemas.learning import ContactKind, ContactSource

# 修订资源类型 ↔ 备份集合：导出、校验、映射共用同一张表。
RESOURCE_COLLECTIONS = {
    "card": "cards",
    "lesson": "lessons",
    "story": "stories",
}
_COLLECTION_RESOURCES = {value: key for key, value in RESOURCE_COLLECTIONS.items()}


@dataclass(frozen=True)
class ExtensionSpec:
    """一个已登记的 V3 扩展集合。"""

    name: str
    schema: type[BaseModel]
    parents: tuple[str, ...]
    remap: Callable[[dict, dict[str, dict[int, int]]], dict]
    model: type | None = None
    complete: bool = False
    unique: tuple[str, ...] = ()


_EXTENSIONS: dict[str, ExtensionSpec] = {}


def register_extension(
    name: str,
    schema: type[BaseModel],
    parents: tuple[str, ...],
    remap: Callable[[dict, dict[str, dict[int, int]]], dict],
    *,
    model: type | None = None,
    complete: bool = False,
    unique: tuple[str, ...] = (),
) -> None:
    """登记扩展集合；重复登记是编程错误，拒绝静默覆盖。

    model 是导出与恢复删除拓扑使用的持久模型；登记顺序即导出顺序。
    complete 表示快照必须为每个父实体包含一行（如当前修订身份）。
    unique 表示集合内不得重复的字段（如提交标识）。
    """
    if name in _EXTENSIONS:
        raise ValueError(f"扩展集合已登记：{name}")
    _EXTENSIONS[name] = ExtensionSpec(
        name, schema, parents, remap, model, complete, unique
    )


def registered_extensions() -> dict[str, ExtensionSpec]:
    return dict(_EXTENSIONS)


class FullContentRevision(FullRow):
    id: int = Field(gt=0, strict=True)
    resource_kind: Literal["card", "lesson", "story"]
    resource_id: int = Field(gt=0, strict=True)
    identity: str = Field(min_length=36, max_length=36)
    version: int = Field(ge=1, strict=True)


def _remap_content_revision(row: dict, mapping: dict[str, dict[int, int]]) -> dict:
    collection = RESOURCE_COLLECTIONS[row["resource_kind"]]
    return {**row, "resource_id": mapping[collection][row["resource_id"]]}


register_extension(
    "content_revisions",
    FullContentRevision,
    tuple(RESOURCE_COLLECTIONS.values()),
    _remap_content_revision,
    model=ContentRevision,
    complete=True,
)


class FullLearningContact(FullRow):
    """已确认的应用内接触；旧 V2/V3 没有该集合时保持未知。"""

    id: int = Field(gt=0, strict=True)
    submission_id: str
    card_id: int = Field(gt=0, strict=True)
    card_identity: str
    card_revision: int = Field(ge=1, strict=True)
    source: ContactSource
    kind: ContactKind
    # 快照中的时间是 JSON 字符串；字段单独放宽，其余仍保持严格。
    occurred_at: datetime = Field(strict=False)

    @field_validator("submission_id", "card_identity")
    @classmethod
    def _uuid(cls, value: str) -> str:
        try:
            return str(UUID(value))
        except (ValueError, TypeError) as error:
            raise ValueError("必须是 UUID") from error


def _remap_learning_contact(row: dict, mapping: dict[str, dict[int, int]]) -> dict:
    return {**row, "card_id": mapping["cards"][row["card_id"]]}


register_extension(
    "learning_contacts",
    FullLearningContact,
    ("cards",),
    _remap_learning_contact,
    model=LearningContact,
    unique=("submission_id",),
)


class FullLessonProgress(FullRow):
    """课程的生成/浏览状态；旧 V3 没有该集合时保持状态未记录。"""

    id: int = Field(gt=0, strict=True)
    lesson_id: int = Field(gt=0, strict=True)
    generation_id: str
    generated: bool = Field(strict=True)
    generated_at: datetime = Field(strict=False)
    opened: bool = Field(strict=True)
    opened_at: datetime | None = Field(default=None, strict=False)
    browsed: bool = Field(strict=True)
    browsed_at: datetime | None = Field(default=None, strict=False)
    view_submission_id: str | None = None
    view_submissions: list[str] = Field(default_factory=list)
    checked_count: int = Field(ge=0, strict=True)
    passed_count: int = Field(ge=0, strict=True)

    @field_validator("generation_id", "view_submission_id")
    @classmethod
    def _uuid(cls, value: str | None) -> str | None:
        if value is None:
            return None
        try:
            return str(UUID(value))
        except (ValueError, TypeError) as error:
            raise ValueError("必须是 UUID") from error

    @field_validator("view_submissions")
    @classmethod
    def _uuid_list(cls, values: list[str]) -> list[str]:
        result = []
        for value in values:
            try:
                result.append(str(UUID(value)))
            except (ValueError, TypeError) as error:
                raise ValueError("必须是 UUID") from error
        return result


def _remap_lesson_progress(row: dict, mapping: dict[str, dict[int, int]]) -> dict:
    return {**row, "lesson_id": mapping["lessons"][row["lesson_id"]]}


register_extension(
    "lesson_progress",
    FullLessonProgress,
    ("lessons",),
    _remap_lesson_progress,
    model=LessonProgress,
    unique=("generation_id", "lesson_id"),
)


class FullEventV3(FullEvent):
    """V3 events carry the revision seen when the submission was accepted.

    Older V3 snapshots (EL-01) lack the fields; null means "history
    incomplete" rather than an invented link.
    """

    card_identity: str | None = None
    card_revision: int | None = Field(default=None, ge=1)


class FullBackupV3(FullBackup):
    version: Literal[3]  # type: ignore[assignment] — pydantic 收窄字面量
    features: list[str]
    extensions: dict[str, list[dict]]
    learning_events: list[FullEventV3]


def _reject(collection: str, index, field: str, reason: str) -> NoReturn:
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


def _validate_extension_rows(name: str, rows: list) -> list[dict]:
    spec = _EXTENSIONS[name]
    if not isinstance(rows, list):
        _reject(name, "0", "?", "必须是数组")
    try:
        return [spec.schema.model_validate(row).model_dump() for row in rows]
    except ValidationError as error:
        raise BackupValidationError(_issues_from_error(error, name)) from error


def _validate_extension_graph(
    extensions: dict[str, list[dict]], tables: dict[str, list[dict]]
) -> None:
    ids = {name: {row["id"] for row in rows} for name, rows in tables.items()}
    for name, rows in extensions.items():
        spec = _EXTENSIONS[name]
        resource_keys = set()
        identities = set()
        for index, row in enumerate(rows):
            for parent in spec.parents:
                singular = _COLLECTION_RESOURCES.get(
                    parent, parent.removesuffix("s")
                )
                if row.get("resource_kind") is not None:
                    if (
                        row["resource_kind"] == singular
                        and row["resource_id"] not in ids[parent]
                    ):
                        _reject(name, index, "resource_id", "引用了备份中不存在的实体")
                elif (
                    f"{singular}_id" in row
                    and row[f"{singular}_id"] not in ids[parent]
                ):
                    _reject(
                        name,
                        index,
                        f"{singular}_id",
                        "引用了备份中不存在的实体",
                    )
            if "identity" in row:
                try:
                    UUID(row["identity"])
                except (ValueError, TypeError):
                    _reject(name, index, "identity", "必须是 UUID")
                if row["identity"] in identities:
                    _reject(name, index, "identity", "实体身份重复")
                identities.add(row["identity"])
            if "resource_kind" in row and "resource_id" in row:
                key = (row["resource_kind"], row["resource_id"])
                if key in resource_keys:
                    _reject(name, index, "resource_id", "同一实体重复登记修订")
                resource_keys.add(key)
        for field in spec.unique:
            values = [row[field] for row in rows]
            if len(values) != len(set(values)):
                _reject(name, "?", field, "唯一标识重复")
        if spec.complete:
            # Declared-but-incomplete snapshots would silently mint new
            # identities during restore; reject them before any write.
            for kind, collection in RESOURCE_COLLECTIONS.items():
                covered = {
                    row["resource_id"]
                    for row in rows
                    if row.get("resource_kind") == kind
                }
                missing = sorted(ids[collection] - covered)
                if missing:
                    _reject(
                        name,
                        "?",
                        "resource_id",
                        f"缺少 {kind} 的当前修订：{missing[:5]}",
                    )


def validate_v3(payload: dict) -> ValidatedBackup:
    if not isinstance(payload, dict):
        _reject("backup", "0", "?", "必须是对象")
    features = payload.get("features")
    extensions = payload.get("extensions")
    if not isinstance(features, list) or not all(
        isinstance(feature, str) for feature in features
    ):
        _reject("features", "0", "?", "必须是字符串数组")
    if len(features) != len(set(features)):
        _reject("features", "?", "?", "功能重复")
    if not isinstance(extensions, dict):
        _reject("extensions", "0", "?", "必须是对象")
    features = cast(list[str], features)
    extensions = cast(dict[str, list], extensions)
    if set(features) != set(extensions):
        _reject("features", "?", "?", "features 与 extensions 键必须一致")
    unknown = [feature for feature in features if feature not in _EXTENSIONS]
    if unknown:
        _reject("features", "?", "?", f"未知功能：{','.join(unknown)}")

    try:
        parsed = FullBackupV3.model_validate_json(json.dumps(payload))
    except ValidationError as error:
        issues = []
        for item in error.errors():
            location = [str(part) for part in item["loc"]]
            issues.append(
                {
                    "collection": location[0] if location else "?",
                    "index": location[1] if len(location) > 1 else "?",
                    "field": ".".join(location[2:]) or "?",
                    "reason": item["msg"],
                }
            )
        raise BackupValidationError(issues) from error

    tables = parsed.model_dump(
        exclude={"version", "exported_at", "learning_timezone", "features", "extensions"}
    )
    from app.schemas.backup import _validate_full_graph

    _validate_full_graph(tables, payload)
    for index, row in enumerate(tables["learning_events"]):
        identity = row.get("card_identity")
        version = row.get("card_revision")
        if (identity is None) != (version is None):
            _reject(
                "learning_events",
                index,
                "card_identity/card_revision",
                "事件修订关联不完整",
            )
        if identity is not None:
            try:
                UUID(identity)
            except (ValueError, TypeError):
                _reject("learning_events", index, "card_identity", "必须是 UUID")
    validated_extensions = {
        name: _validate_extension_rows(name, extensions.get(name) or [])
        for name in features
    }
    _validate_extension_graph(validated_extensions, tables)
    # 接触的修订归属必须能由快照自身解释：身份与当前修订一致，版本不晚于它。
    card_revisions = {
        row["resource_id"]: row
        for row in validated_extensions.get("content_revisions", [])
        if row["resource_kind"] == "card"
    }
    for index, contact in enumerate(validated_extensions.get("learning_contacts", [])):
        revision = card_revisions.get(contact["card_id"])
        if revision is None or str(UUID(revision["identity"])) != contact["card_identity"]:
            _reject(
                "learning_contacts",
                index,
                "card_identity",
                "与快照中的内容修订身份不一致",
            )
        if contact["card_revision"] > revision["version"]:
            _reject(
                "learning_contacts",
                index,
                "card_revision",
                "晚于快照中的当前内容修订",
            )
    progress_rows = validated_extensions.get("lesson_progress", [])
    view_ids = []
    for row in progress_rows:
        if row["view_submission_id"] is not None:
            view_ids.append(row["view_submission_id"])
        view_ids.extend(row["view_submissions"])
    if len(view_ids) != len(set(view_ids)):
        _reject("lesson_progress", "?", "view_submission_id", "浏览提交标识重复")
    for index, row in enumerate(progress_rows):
        if row["passed_count"] > row["checked_count"]:
            _reject(
                "lesson_progress",
                index,
                "passed_count",
                "通过数不能超过检查数",
            )
    return ValidatedBackup(
        version=3,
        mode="full_replace",
        tables=tables,
        extensions=validated_extensions,
        payload_digest=_digest(payload),
    )


__all__ = [
    "ExtensionSpec",
    "FullBackupV3",
    "FullContentRevision",
    "register_extension",
    "registered_extensions",
    "validate_v3",
]
