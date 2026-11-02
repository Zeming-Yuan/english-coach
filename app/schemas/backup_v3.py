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
from app.models.practice import PracticeItem, PracticeSession
from app.models.story_version import StoryVersion
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
from app.schemas.practice import PracticeAssistance

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


class FullStoryVersion(FullRow):
    id: int = Field(gt=0, strict=True)
    story_id: int | None = Field(default=None, gt=0, strict=True)
    version_id: str
    operation_id: str
    include_new_target: bool
    story_identity: str
    story_revision: int = Field(ge=1, strict=True)
    mode: Literal["normal", "short"] = "normal"
    parent_version_id: str | None = None
    material: dict
    quality: dict

    @field_validator("parent_version_id")
    @classmethod
    def _parent_uuid(cls, value):
        return str(UUID(value)) if value is not None else None

    @field_validator("version_id", "operation_id", "story_identity")
    @classmethod
    def _uuid(cls, value):
        return str(UUID(value))


def _remap_story_version(row, mapping):
    return {
        **row,
        "story_id": mapping["stories"][row["story_id"]]
        if row["story_id"] is not None
        else None,
    }


register_extension(
    "story_versions",
    FullStoryVersion,
    ("stories",),
    _remap_story_version,
    model=StoryVersion,
    unique=("version_id", "operation_id"),
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


class FullPracticeSession(FullRow):
    """一轮持久练习；status 是生命周期，检查结果由题目首答推导。"""

    id: int = Field(gt=0, strict=True)
    session_id: str
    purpose: Literal["lesson_check", "delayed_check", "targeted", "story_check"]
    version_id: str | None = None
    lesson_id: int | None = Field(default=None, gt=0, strict=True)
    window: Literal["day", "week"] | None = None
    pending_contact_ids: list[str] = Field(default_factory=list)
    status: Literal["active", "completed", "unavailable"]
    rule_version: str
    created_at: datetime = Field(strict=False)
    completed_at: datetime | None = Field(default=None, strict=False)

    @field_validator("session_id")
    @classmethod
    def _uuid(cls, value: str) -> str:
        try:
            return str(UUID(value))
        except (ValueError, TypeError) as error:
            raise ValueError("必须是 UUID") from error


class RetentionRecord(FullRow):
    anchor_at: str | None
    anchor_kind: Literal["event", "contact"] | None = None
    anchor_id: str | None = None
    gap_seconds: int | None = Field(ge=0, strict=True)
    window: Literal["day", "week", "other"]
    integrity: Literal["confirmed", "incomplete"]


class FullPracticeItem(FullRow):
    """冻结的一道短测题；首答结果只关联真实学习事件。"""

    id: int = Field(gt=0, strict=True)
    item_id: str
    session_id: str
    position: int = Field(ge=1, strict=True)
    card_id: int = Field(gt=0, strict=True)
    card_identity: str
    card_revision: int = Field(ge=1, strict=True)
    prompt: str = Field(min_length=1)
    kind: Literal["typed", "reading_choice"]
    question: dict | None = None
    assistance: list[PracticeAssistance]
    first_event_id: str | None = None
    retention_basis: RetentionRecord | None = None
    retention_result: RetentionRecord | None = None
    created_at: datetime = Field(strict=False)

    @field_validator("item_id", "session_id", "card_identity", "first_event_id")
    @classmethod
    def _uuid(cls, value: str | None) -> str | None:
        if value is None:
            return None
        try:
            return str(UUID(value))
        except (ValueError, TypeError) as error:
            raise ValueError("必须是 UUID") from error


def _remap_practice_session(row: dict, mapping: dict[str, dict[int, int]]) -> dict:
    return {
        **row,
        "lesson_id": mapping["lessons"][row["lesson_id"]]
        if row["lesson_id"] is not None
        else None,
    }


def _remap_practice_item(row: dict, mapping: dict[str, dict[int, int]]) -> dict:
    return {**row, "card_id": mapping["cards"][row["card_id"]]}


register_extension(
    "practice_sessions",
    FullPracticeSession,
    ("lessons", "story_versions"),
    _remap_practice_session,
    model=PracticeSession,
    unique=("session_id",),
)

register_extension(
    "practice_items",
    FullPracticeItem,
    ("cards",),
    _remap_practice_item,
    model=PracticeItem,
    unique=("item_id",),
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
    learning_events: list[FullEventV3]  # type: ignore[reportIncompatibleVariableOverride] — Pydantic V3 narrows event schema


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
        extension_ids = set()
        for index, row in enumerate(rows):
            if "id" in row:
                if row["id"] in extension_ids:
                    _reject(name, index, "id", "源 ID 重复")
                extension_ids.add(row["id"])
            for parent in spec.parents:
                singular = _COLLECTION_RESOURCES.get(parent, parent.removesuffix("s"))
                if row.get("resource_kind") is not None:
                    if (
                        row["resource_kind"] == singular
                        and row["resource_id"] not in ids[parent]
                    ):
                        _reject(name, index, "resource_id", "引用了备份中不存在的实体")
                elif (
                    f"{singular}_id" in row
                    and row[f"{singular}_id"] is not None
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
        exclude={
            "version",
            "exported_at",
            "learning_timezone",
            "features",
            "extensions",
        }
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
        if (
            revision is None
            or str(UUID(revision["identity"])) != contact["card_identity"]
        ):
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
    from app.services.story_quality import story_coverage, validate_story

    story_revisions = {
        r["resource_id"]: r
        for r in validated_extensions.get("content_revisions", [])
        if r["resource_kind"] == "story"
    }
    stories_by_id = {r["id"]: r for r in tables["stories"]}
    versions_by_id = {
        r["version_id"]: r for r in validated_extensions.get("story_versions", [])
    }
    version_stories = set()
    for index, row in enumerate(validated_extensions.get("story_versions", [])):
        parent = versions_by_id.get(row["parent_version_id"])
        if row["mode"] == "normal" and row["parent_version_id"] is not None:
            _reject("story_versions", index, "parent_version_id", "原版不能引用父版本")
        if row["mode"] == "short" and (
            parent is None
            or parent["mode"] != "normal"
            or parent["material"].get("targets") != row["material"].get("targets")
            or parent["include_new_target"] != row["include_new_target"]
        ):
            _reject(
                "story_versions", index, "parent_version_id", "简化版须引用同目标原版"
            )
        quality = row["quality"]
        material = row["material"]
        for field in (
            "known_words",
            "support_words",
            "known_targets",
            "new_targets",
            "unknown_forms",
        ):
            if not isinstance(quality.get(field), list) or any(
                not isinstance(v, str) for v in quality[field]
            ):
                _reject("story_versions", index, "quality", "词形依据必须为字符串数组")
        known = set(quality["known_words"])
        support = set(quality["support_words"])
        errors = validate_story(
            material, known, support, row["mode"], require_check=False
        )
        if (
            errors
            or quality.get("known_basis") != "verified"
            or not isinstance(quality.get("support_version"), str)
            or not 1 <= len(quality["known_targets"]) <= 3
            or len(quality["new_targets"]) > int(row["include_new_target"])
            or any(t not in known for t in quality["known_targets"])
            or material.get("targets")
            != quality["known_targets"] + quality["new_targets"]
        ):
            _reject("story_versions", index, "material", "故事质量或目标依据不合法")
        check = material.get("check")
        if check is not None and (
            check.get("evidence_sentence")
            != material["sentences"][check["evidence_index"]]["en"]
        ):
            _reject(
                "story_versions", index, "material.check", "证据句与固定上下文不一致"
            )
        coverage = story_coverage(material, known, support)
        if any(quality.get(field) != value for field, value in coverage.items()):
            _reject("story_versions", index, "quality", "覆盖检查与材料不一致")
        if row["story_id"] is not None:
            if row["story_id"] in version_stories:
                _reject("story_versions", index, "story_id", "故事当前版本重复")
            version_stories.add(row["story_id"])
            revision = story_revisions.get(row["story_id"])
            if (
                revision is None
                or revision["identity"] != row["story_identity"]
                or revision["version"] < row["story_revision"]
            ):
                _reject("story_versions", index, "story_identity", "故事修订引用不一致")
            story = stories_by_id[row["story_id"]]
            if revision["version"] == row["story_revision"] and any(
                story[k] != v
                for k, v in {
                    "title": material["title"],
                    "title_cn": material["title_cn"],
                    "content": "\n".join(r["en"] for r in material["sentences"]),
                    "content_cn": "\n".join(r["cn"] for r in material["sentences"]),
                }.items()
            ):
                _reject("story_versions", index, "material", "故事原文与版本材料不一致")
    sessions = validated_extensions.get("practice_sessions", [])
    items = validated_extensions.get("practice_items", [])
    session_ids = {row["session_id"] for row in sessions}
    sessions_by_id = {row["session_id"]: row for row in sessions}
    event_rows = {row["id"]: row for row in tables["learning_events"]}
    items_by_session: dict[str, list[dict]] = {}
    positions = set()
    cards_in_session = set()
    first_events = set()
    for index, item in enumerate(items):
        if item["session_id"] not in session_ids:
            _reject(
                "practice_items",
                index,
                "session_id",
                "引用了快照中不存在的练习轮次",
            )
        position_key = (item["session_id"], item["position"])
        if position_key in positions:
            _reject("practice_items", index, "position", "轮次内题目序号重复")
        positions.add(position_key)
        card_key = (item["session_id"], item["card_id"], item["kind"])
        if card_key in cards_in_session:
            _reject("practice_items", index, "card_id", "轮次内目标词重复")
        cards_in_session.add(card_key)
        items_by_session.setdefault(item["session_id"], []).append(item)
        revision = card_revisions.get(item["card_id"])
        if (
            revision is None
            or str(UUID(revision["identity"])) != item["card_identity"]
            or item["card_revision"] > revision["version"]
        ):
            _reject(
                "practice_items",
                index,
                "card_identity/card_revision",
                "与快照中的内容修订不一致",
            )
        if item["first_event_id"] is not None:
            if item["first_event_id"] in first_events:
                _reject("practice_items", index, "first_event_id", "首答事件重复")
            first_events.add(item["first_event_id"])
            event = event_rows.get(item["first_event_id"])
            if (
                event is None
                or event["card_id"] != item["card_id"]
                or event["source"]
                != (
                    "story"
                    if sessions_by_id[item["session_id"]]["purpose"] == "story_check"
                    else "lesson"
                    if sessions_by_id[item["session_id"]]["purpose"] == "lesson_check"
                    else "spelling"
                )
                or event["kind"]
                != ("choice" if item["kind"] == "reading_choice" else "typed")
                or event["session_id"] != item["session_id"]
            ):
                _reject(
                    "practice_items",
                    index,
                    "first_event_id",
                    "首答事件与题目不一致",
                )
    versions_by_id = {
        r["version_id"]: r for r in validated_extensions.get("story_versions", [])
    }
    for index, practice in enumerate(sessions):
        rows = items_by_session.get(practice["session_id"], [])
        if practice["purpose"] == "story_check":
            version = versions_by_id.get(practice["version_id"])
            if (
                version is None
                or practice["lesson_id"] is not None
                or practice["window"] is not None
                or practice["pending_contact_ids"]
            ):
                _reject(
                    "practice_sessions",
                    index,
                    "version_id",
                    "读后检查缺少版本或混合其他用途",
                )
            if len(rows) > 2 or len({r["kind"] for r in rows}) != len(rows):
                _reject("practice_items", index, "kind", "读后检查最多各一种题目")
            targets = version["material"]["targets"]
            cards_by_id = {c["id"]: c for c in tables["cards"]}
            for item in rows:
                if (
                    item["card_revision"] == card_revisions[item["card_id"]]["version"]
                    and cards_by_id[item["card_id"]]["word"].lower() not in targets
                ):
                    _reject("practice_items", index, "card_id", "不是版本中的目标词")
                if item["kind"] == "reading_choice" and (
                    not isinstance(item["question"], dict)
                    or item["question"] != version["material"].get("check")
                    or item["prompt"] != item["question"]["question"]
                ):
                    _reject("practice_items", index, "question", "题目与版本材料不一致")
                if item["kind"] == "typed" and item["question"] is not None:
                    _reject(
                        "practice_items", index, "question", "输入题不得携带选择上下文"
                    )
                if item["first_event_id"]:
                    event = event_rows[item["first_event_id"]]
                    if (
                        event["stage"] != "standalone"
                        or event["assistance"] != item["assistance"]
                        or event["card_identity"] != item["card_identity"]
                        or event["card_revision"] != item["card_revision"]
                    ):
                        _reject(
                            "practice_items",
                            index,
                            "first_event_id",
                            "首答帮助或阶段不一致",
                        )
                    question = item["question"] or {}
                    if item["kind"] == "reading_choice" and event["command_json"].get(
                        "question"
                    ) != {
                        "card_id": item["card_id"],
                        "kind": "choice",
                        "options": question["options"],
                        "expected": question["expected"],
                    }:
                        _reject(
                            "practice_items",
                            index,
                            "first_event_id",
                            "首答判分上下文与版本不一致",
                        )
        elif practice["version_id"] is not None or any(
            r["kind"] != "typed"
            or r["question"] is not None
            or "answer_visible" in r["assistance"]
            for r in rows
        ):
            _reject(
                "practice_sessions",
                index,
                "purpose",
                "其他用途不能携带故事题或回看帮助",
            )
        if (
            practice["status"] == "unavailable"
            and rows
            and practice["purpose"] == "lesson_check"
        ):
            _reject(
                "practice_sessions",
                index,
                "status",
                "不可用轮次不能包含题目",
            )
        if practice["status"] != "unavailable" and not rows:
            _reject("practice_sessions", index, "status", "可作答轮次缺少题目")
        processed = [row["first_event_id"] is not None for row in rows]
        if practice["status"] == "completed" and not all(processed):
            _reject("practice_sessions", index, "status", "完成轮次存在未作答题")
        if practice["status"] == "active" and processed and all(processed):
            _reject("practice_sessions", index, "status", "未完成轮次不应全部作答")
    from app.services.retention import validate_retention_graph

    validate_retention_graph(
        sessions_by_id,
        items,
        event_rows,
        validated_extensions.get("learning_contacts", []),
        _reject,
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
