"""V3 完整备份：显式登记扩展集合、校验并映射恢复。

V3 在 V2 核心集合之外增加 features 与 extensions。每个扩展集合必须先在本
模块登记 schema、父引用与 ID 重映射，导出、校验和恢复共享同一份登记；
未知功能拒绝恢复，避免静默丢数据。
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal, NoReturn, cast
from uuid import UUID

from pydantic import BaseModel, Field, ValidationError

from app.models.content_revision import ContentRevision
from app.schemas.backup import (
    BackupValidationError,
    FullBackup,
    FullRow,
    ValidatedBackup,
    _digest,
    _issues_from_error,
)

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


_EXTENSIONS: dict[str, ExtensionSpec] = {}


def register_extension(
    name: str,
    schema: type[BaseModel],
    parents: tuple[str, ...],
    remap: Callable[[dict, dict[str, dict[int, int]]], dict],
    *,
    model: type | None = None,
) -> None:
    """登记扩展集合；重复登记是编程错误，拒绝静默覆盖。

    model 是导出与恢复删除拓扑使用的持久模型；登记顺序即导出顺序。
    """
    if name in _EXTENSIONS:
        raise ValueError(f"扩展集合已登记：{name}")
    _EXTENSIONS[name] = ExtensionSpec(name, schema, parents, remap, model)


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
    ("cards", "lessons", "stories"),
    _remap_content_revision,
    model=ContentRevision,
)


class FullBackupV3(FullBackup):
    version: Literal[3]  # type: ignore[assignment] — pydantic 收窄字面量
    features: list[str]
    extensions: dict[str, list[dict]]


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
    validated_extensions = {
        name: _validate_extension_rows(name, extensions.get(name) or [])
        for name in features
    }
    _validate_extension_graph(validated_extensions, tables)
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
