"""Freeze a checked application question for a confirmed expansion selection."""

import json
from functools import cache
from pathlib import Path
from uuid import uuid4

from sqlalchemy.orm import Session

from app.models.card import Card
from app.services.content_revisions import get_content_revision
from app.services.expansion_additions import confirmed_addition

RULE_VERSION = "s95-expansion-v1"
CHOICE_KIND = "expansion_choice"


@cache
def materials() -> tuple[dict, ...]:
    path = Path(__file__).resolve().parents[1] / "data" / "expansion_practice.json"
    rows = json.loads(path.read_text(encoding="utf-8"))
    versions = set()
    for row in rows:
        question = row["question"]
        options = [word.strip().casefold() for word in question["options"]]
        if (
            row["version"] in versions
            or len(options) < 2
            or len(options) != len(set(options))
            or "" in options
            or question["expected"] not in question["options"]
            or question["expected"] != row["target_word"]
            or question["prompt"].count("___") != 1
            or not question["explanation"].strip()
        ):
            raise ValueError("扩展题材必须提供可区分的选项、唯一答案和用法说明")
        versions.add(row["version"])
    return tuple(rows)


def material_for_version(version: str | None) -> dict | None:
    if version is None:
        return None
    return next((row for row in materials() if row["version"] == version), None)


def _revision(identity: str, version: int) -> dict:
    return {"identity": identity, "version": version}


def expansion_items(
    db: Session, command: dict, target_command: dict
) -> tuple[dict, list[dict]]:
    from app.services.practice import (
        PracticeNotFoundError,
        PracticeStaleError,
    )

    addition = confirmed_addition(db, command["addition_operation_id"])
    if addition is None:
        raise PracticeNotFoundError("加入记录不存在，请先明确加入扩展词")
    source = db.get(Card, command["source_card_id"])
    target = db.get(Card, target_command["card_id"])
    if source is None or target is None:
        raise PracticeNotFoundError("来源或目标词卡已删除，请重新查看扩展词")
    if (addition.source_card_id, addition.target_card_id) != (source.id, target.id):
        raise PracticeStaleError("加入记录与当前来源或目标不一致")
    source_revision = get_content_revision(db, "card", source.id)
    target_revision = get_content_revision(db, "card", target.id)
    if (
        source_revision != command["source_revision"]
        or target_revision != target_command["revision"]
    ):
        raise PracticeStaleError("词卡内容已修订，请重新查看后练习")

    material = next(
        (
            row
            for row in materials()
            if source.word.strip().casefold() == row["source_word"]
            and (source.meaning or "").strip() == row["source_meaning"]
            and target.word.strip().casefold()
            == addition.target_word
            == row["target_word"]
            and addition.target_meaning in row["target_meanings"]
            and (target.meaning or "").strip() in row["target_meanings"]
        ),
        None,
    )
    snapshot = {
        "addition_operation_id": addition.operation_id,
        "original_source_id": source.id,
        "original_target_id": target.id,
        "source_identity": source_revision["identity"],
        "source_version": source_revision["version"],
        "target_identity": target_revision["identity"],
        "target_version": target_revision["version"],
        "material_version": material["version"] if material else None,
    }
    if material is None:
        return snapshot, []
    question = material["question"]
    return snapshot, [
        {
            "item_id": str(uuid4()),
            "card_id": target.id,
            "card_identity": target_revision["identity"],
            "card_revision": target_revision["version"],
            "position": 1,
            "kind": CHOICE_KIND,
            "prompt": question["prompt"],
            "question": question,
        }
    ]


def check_expansion_replay(db: Session, snapshot: dict, command: dict, target: dict):
    from app.services.practice import PracticeConflictError

    ids = (command["source_card_id"], target["card_id"])
    valid_ids = {(snapshot["original_source_id"], snapshot["original_target_id"])}
    if snapshot["addition_operation_id"] == command["addition_operation_id"]:
        addition = confirmed_addition(db, command["addition_operation_id"])
        if addition is not None:
            valid_ids.add((addition.source_card_id, addition.target_card_id))
    if (
        snapshot["addition_operation_id"] != command["addition_operation_id"]
        or command["source_revision"]
        != _revision(snapshot["source_identity"], snapshot["source_version"])
        or target["revision"]
        != _revision(snapshot["target_identity"], snapshot["target_version"])
        or ids not in valid_ids
    ):
        raise PracticeConflictError("该练习轮次标识已用于其他扩展词或修订")


def expansion_source_current(db: Session, snapshot: dict | None) -> bool:
    if not snapshot:
        return False
    addition = confirmed_addition(db, snapshot["addition_operation_id"])
    if (
        addition is None
        or addition.source_card_id is None
        or addition.target_card_id is None
    ):
        return False
    try:
        current = get_content_revision(db, "card", addition.source_card_id)
    except LookupError:
        return False
    return current == _revision(snapshot["source_identity"], snapshot["source_version"])
