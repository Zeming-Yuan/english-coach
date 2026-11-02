"""Scene backup graph validation: frozen tasks, original responses and references."""

from collections.abc import Callable
from datetime import datetime
from typing import Literal, NoReturn
from uuid import UUID

from pydantic import Field, field_validator

from app.schemas.backup import FullRow
from app.services.scenes import (
    command_fingerprint,
    judge,
    novel_task_context,
    scene_command,
    scene_rules,
)


class SceneCommandRecord(FullRow):
    session_id: str
    item_id: str
    answer: str | None = Field(max_length=2000)
    skipped: bool
    client_assistance: list[
        Literal["hint", "answer_visible", "answer_audio", "first_letter"]
    ]


class SceneResponseRecord(FullRow):
    committed: Literal[True]
    attempt_id: str
    verdict: Literal["accepted", "rejected", "unknown"]
    skipped: bool
    first_response: bool
    session: dict


class FullSceneAttempt(FullRow):
    id: int = Field(gt=0, strict=True)
    attempt_id: str
    submission_id: str
    session_id: str
    item_id: str
    answer: str | None = Field(max_length=2000)
    skipped: bool
    assistance: list[
        Literal["hint", "answer_visible", "answer_audio", "retry", "first_letter"]
    ]
    verdict: Literal["accepted", "rejected", "unknown"]
    task_key: str
    rule_version: str
    target_mapping: list[dict]
    fingerprint: str
    command_json: SceneCommandRecord
    response: SceneResponseRecord
    occurred_at: datetime = Field(strict=False)

    @field_validator("attempt_id", "submission_id", "session_id", "item_id")
    @classmethod
    def _uuid(cls, value):
        return str(UUID(value))


def validate_scene_graph(
    sessions, items, attempts, events, cards, revisions, reject: Callable[..., NoReturn]
):
    scenes = {p["session_id"]: p for p in sessions if p["purpose"] == "scene"}
    by_item = {i["item_id"]: i for i in items}
    by_attempt = {a["attempt_id"]: a for a in attempts}
    used_submissions = {e["submission_id"] for e in events}
    cards_by_id = {c["id"]: c for c in cards}
    revision_by_identity = {
        r["identity"]: r for r in revisions if r["resource_kind"] == "card"
    }
    for index, p in enumerate(sessions):
        if p["purpose"] != "scene":
            if p["scene_id"] is not None or p["scene_snapshot"] is not None:
                reject(
                    "practice_sessions",
                    index,
                    "scene_id",
                    "非场景用途不能包含场景上下文",
                )
            continue
        rules = scene_rules("drinks")
        rows = sorted(
            [i for i in items if i["session_id"] == p["session_id"]],
            key=lambda i: i["position"],
        )
        if (
            p["scene_id"] != "drinks"
            or p["scene_snapshot"] != rules
            or p["rule_version"] != rules["rule_version"]
            or any(
                (p["lesson_id"], p["version_id"], p["window"], p["pending_contact_ids"])
            )
        ):
            reject(
                "practice_sessions", index, "scene_snapshot", "场景规则身份或用途不一致"
            )
        if [i["position"] for i in rows] != [1, 2, 3]:
            reject("practice_items", index, "position", "场景必须保留三个固定任务")
        missing = False
        for item, task in zip(rows, rules["tasks"]):
            if (
                item["kind"] != "scene_text"
                or any(
                    item[k] is not None
                    for k in (
                        "card_id",
                        "card_identity",
                        "card_revision",
                        "first_event_id",
                        "retention_basis",
                        "retention_result",
                    )
                )
                or item["prompt"] != task["goal"]
                or (item["question"] or {}).get("task_key") != task["task_key"]
            ):
                reject("practice_items", index, "question", "场景题目与冻结任务不一致")
            if set(item["assistance"]) - {"hint", "answer_visible", "answer_audio"}:
                reject("practice_items", index, "assistance", "场景帮助类型无效")
            targets = item["question"].get("target_mapping")
            _targets(targets, task, reject, index)
            for target in targets:
                current = revision_by_identity.get(target["identity"])
                if current is not None and (
                    target["version"] > current["version"]
                    or target["version"] == current["version"]
                    and target["word"]
                    != cards_by_id[current["resource_id"]]["word"].lower()
                ):
                    reject(
                        "practice_items",
                        index,
                        "question.target_mapping",
                        "目标词形与当前内容修订不一致",
                    )
            first = by_attempt.get(item["first_task_attempt_id"])
            if item["first_task_attempt_id"] is not None and (
                first is None
                or first["item_id"] != item["item_id"]
                or "retry" in first["assistance"]
            ):
                reject(
                    "practice_items",
                    index,
                    "first_task_attempt_id",
                    "首答引用与题目不一致",
                )
            if first is None:
                missing = True
            elif missing:
                reject(
                    "practice_items",
                    index,
                    "first_task_attempt_id",
                    "场景不能越过未处理任务",
                )
    for index, a in enumerate(attempts):
        item = by_item.get(a["item_id"])
        practice = scenes.get(a["session_id"])
        if item is None or practice is None or item["session_id"] != a["session_id"]:
            reject("scene_attempts", index, "item_id", "作答不属于该场景题目")
        task = practice["scene_snapshot"]["tasks"][item["position"] - 1]
        command = scene_command(
            a["session_id"],
            a["item_id"],
            a["answer"],
            a["skipped"],
            a["command_json"].get("client_assistance", []),
        )
        if (
            command != a["command_json"]
            or a["fingerprint"] != command_fingerprint(command)
            or a["verdict"] != judge(task, a["answer"], a["skipped"])
            or a["task_key"] != task["task_key"]
            or a["rule_version"] != practice["rule_version"]
            or a["submission_id"] in used_submissions
            or (not a["skipped"] and not (a["answer"] or "").strip())
        ):
            reject(
                "scene_attempts",
                index,
                "command_json",
                "提交身份、规则判定或指纹不一致",
            )
        _targets(a["target_mapping"], task, reject, index, attempt=True)
        frozen = item["question"]["target_mapping"]
        if [(t["identity"], t["version"], t["word"]) for t in a["target_mapping"]] != [
            (t["identity"], t["version"], t["word"]) for t in frozen
        ]:
            reject(
                "scene_attempts", index, "target_mapping", "作答目标与题目修订不一致"
            )
        for target in a["target_mapping"]:
            novel = novel_task_context(task, a["answer"], target["teaching_examples"])
            if target["novel"] is not novel:
                reject(
                    "scene_attempts",
                    index,
                    "target_mapping",
                    "教学情境依据与新情境判定不一致",
                )
        response = a["response"]
        if (
            response.get("committed") is not True
            or response.get("attempt_id") != a["attempt_id"]
            or response.get("verdict") != a["verdict"]
            or response.get("skipped") != a["skipped"]
            or response.get("first_response")
            != (a["attempt_id"] == item["first_task_attempt_id"])
            or response.get("session", {}).get("id") != a["session_id"]
        ):
            reject("scene_attempts", index, "response", "已保存回放响应与作答不一致")
        _validate_cached_scene(a, practice, by_item, by_attempt, reject, index)
        if not set(command["client_assistance"]) <= set(a["assistance"]):
            reject("scene_attempts", index, "assistance", "客户端帮助只能降低独立性")
        if (
            a["attempt_id"] != item["first_task_attempt_id"]
            and "retry" not in a["assistance"]
        ):
            reject("scene_attempts", index, "assistance", "再次练习不能冒充首答")


def _targets(targets, task, reject, index, attempt=False):
    if not isinstance(targets, list):
        reject("scene_attempts", index, "target_mapping", "目标映射必须为数组")
    seen = set()
    for t in targets:
        try:
            UUID(t["identity"])
            valid = (
                type(t["version"]) is int
                and t["version"] >= 1
                and t["word"] in task["target_words"]
                and isinstance(t["teaching_examples"], list)
                and all(isinstance(e, str) for e in t["teaching_examples"])
                and t["identity"] not in seen
            )
            if attempt:
                valid = (
                    valid
                    and type(t["novel"]) is bool
                    and t["context"] == "drinks:water-order"
                )
        except (KeyError, TypeError, ValueError):
            valid = False
        if not valid:
            reject(
                "scene_attempts", index, "target_mapping", "目标修订或教学情境依据无效"
            )
        seen.add(t["identity"])


def _validate_cached_scene(attempt, practice, by_item, by_attempt, reject, index):
    from app.services.scenes import scene_status

    cached = attempt["response"]["session"]
    rules = practice["scene_snapshot"]
    fields = {
        "id": practice["session_id"],
        "purpose": "scene",
        "scene_id": practice["scene_id"],
        "rule_version": practice["rule_version"],
        "content_revision": rules["content_revision"],
        "content_hash": rules["content_hash"],
    }
    views = cached.get("items")
    counts = cached.get("counts")
    rows = sorted(
        [i for i in by_item.values() if i["session_id"] == practice["session_id"]],
        key=lambda i: i["position"],
    )
    if (
        any(cached.get(k) != v for k, v in fields.items())
        or not isinstance(views, list)
        or len(views) != 3
        or not isinstance(counts, dict)
    ):
        reject("scene_attempts", index, "response.session", "回放场景上下文无效")
    for view, item in zip(views, rows):
        if (
            not isinstance(view, dict)
            or view.get("id") != item["item_id"]
            or type(view.get("processed")) is not bool
        ):
            reject(
                "scene_attempts", index, "response.session.items", "回放题目身份无效"
            )
        first = by_attempt.get(item["first_task_attempt_id"])
        processed_at_response = first is not None and first["id"] <= attempt["id"]
        if view["processed"] != processed_at_response:
            reject(
                "scene_attempts",
                index,
                "response.session.items",
                "回放不能隐藏已经保存的首答",
            )
        if view["processed"]:
            if (
                first is None
                or first["id"] > attempt["id"]
                or any(
                    view.get(k) != first[k]
                    for k in (
                        "attempt_id",
                        "answer",
                        "verdict",
                        "skipped",
                        "assistance",
                        "target_mapping",
                    )
                )
            ):
                reject(
                    "scene_attempts",
                    index,
                    "response.session.items",
                    "回放首答与实际记录不一致",
                )
        elif view.get("verdict") is not None or view.get("skipped") is not False:
            reject(
                "scene_attempts",
                index,
                "response.session.items",
                "未处理题目不能伪造成绩",
            )
    if (
        cached.get("status") != scene_status(views)
        or counts.get("total") != 3
        or counts.get("processed") != sum(v["processed"] for v in views)
    ):
        reject(
            "scene_attempts",
            index,
            "response.session.status",
            "回放完成状态与首答不一致",
        )
    if cached.get("application_verified") and (
        scene_status(views) != "independent"
        or not any(t["novel"] for v in views for t in v.get("target_mapping", []))
    ):
        reject(
            "scene_attempts",
            index,
            "response.session.application_verified",
            "回放不能伪造应用证据",
        )
