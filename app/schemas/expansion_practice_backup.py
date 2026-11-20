"""V3 validation for frozen contextual practice and its approved material."""

from uuid import UUID

from pydantic import Field, field_validator

from app.schemas.backup import FullRow
from app.services.expansion_practice import (
    CHOICE_KIND,
    RULE_VERSION,
    material_for_version,
)


class FullExpansionSnapshot(FullRow):
    addition_operation_id: str
    original_source_id: int = Field(gt=0)
    original_target_id: int = Field(gt=0)
    source_identity: str
    source_version: int = Field(gt=0)
    target_identity: str
    target_version: int = Field(gt=0)
    material_version: str | None

    @field_validator("addition_operation_id", "source_identity", "target_identity")
    @classmethod
    def _uuid(cls, value: str) -> str:
        return str(UUID(value))


def validate_expansion_practice(
    index, practice, items, additions, revisions, events, reject
):
    snapshot = practice["expansion_snapshot"]
    if (
        not snapshot
        or not practice["targets_explicit"]
        or practice["rule_version"] != RULE_VERSION
        or practice["window"] is not None
        or practice["lesson_id"] is not None
        or practice["version_id"] is not None
        or practice["scene_id"] is not None
        or practice["scene_snapshot"] is not None
        or practice["weak_only"]
        or practice["pending_contact_ids"]
    ):
        reject(
            "practice_sessions",
            index,
            "expansion_snapshot",
            "扩展练习来源缺失或混用其他用途",
        )
        return
    addition = additions.get(snapshot["addition_operation_id"])
    if (
        addition is None
        or addition["source_identity"] != snapshot["source_identity"]
        or addition["target_identity"] != snapshot["target_identity"]
        or addition["source_version"] > snapshot["source_version"]
    ):
        reject("practice_sessions", index, "expansion_snapshot", "未找到匹配的加入记录")
        return
    for side in ("source", "target"):
        card_id = addition[f"{side}_card_id"]
        revision = revisions.get(card_id)
        if card_id is not None and (
            revision is None
            or str(UUID(revision["identity"])) != snapshot[f"{side}_identity"]
            or revision["version"] < snapshot[f"{side}_version"]
        ):
            reject(
                "practice_sessions",
                index,
                "expansion_snapshot",
                "词卡修订与已加入目标不符",
            )
    material = material_for_version(snapshot["material_version"])
    if snapshot["material_version"] is not None and (
        material is None
        or material["target_word"] != addition["target_word"]
        or addition["target_meaning"] not in material["target_meanings"]
    ):
        reject("practice_sessions", index, "material_version", "未知或不匹配的扩展题材")
    if not items:
        if material and addition["target_card_id"] is not None:
            reject(
                "practice_sessions",
                index,
                "expansion_snapshot",
                "快照缺少冻结的扩展语境题",
            )
        return
    item = items[0]
    if (
        len(items) != 1
        or material is None
        or item["kind"] != CHOICE_KIND
        or item["card_id"] != addition["target_card_id"]
        or item["card_identity"] != snapshot["target_identity"]
        or item["card_revision"] != snapshot["target_version"]
        or item["question"] != material["question"]
        or item["prompt"] != material["question"]["prompt"]
    ):
        reject("practice_items", index, "question", "题目与冻结扩展语境不一致")
        return
    if item["first_event_id"] is None:
        return
    event = events[item["first_event_id"]]
    if (
        event["stage"] != "standalone"
        or event["scheduled"]
        or event["card_identity"] != item["card_identity"]
        or event["card_revision"] != item["card_revision"]
        or event["assistance"] != item["assistance"]
        or event["command_json"].get("question")
        != {
            "card_id": item["card_id"],
            "kind": "choice",
            "options": item["question"]["options"],
            "expected": item["question"]["expected"],
        }
    ):
        reject("practice_items", index, "first_event_id", "首答与冻结扩展语境不一致")
