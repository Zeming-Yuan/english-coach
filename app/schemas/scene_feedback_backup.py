"""V3 feedback records reference a frozen first answer, without new grades."""

from collections.abc import Callable
from datetime import UTC, datetime
from typing import Literal, NoReturn
from uuid import UUID

from pydantic import Field, field_validator

from app.schemas.backup import FullRow


def _utc_naive(value: datetime) -> datetime:
    return value.astimezone(UTC).replace(tzinfo=None) if value.tzinfo else value


class FullSceneFeedback(FullRow):
    id: int = Field(gt=0, strict=True)
    operation_id: str
    session_id: str
    item_id: str
    attempt_id: str
    rule_version: str
    content_hash: str
    feedback_version: Literal["scene-feedback-v1"]
    text: str = Field(min_length=1, max_length=200)
    correction: str | None = Field(max_length=500)
    origin: Literal["template", "model"]
    occurred_at: datetime = Field(strict=False)

    @field_validator("operation_id", "session_id", "item_id", "attempt_id")
    @classmethod
    def _uuid(cls, value: str) -> str:
        return str(UUID(value))

    @field_validator("occurred_at")
    @classmethod
    def _utc(cls, value: datetime) -> datetime:
        return _utc_naive(value)


def validate_feedback_graph(
    sessions, items, attempts, feedback, reject: Callable[..., NoReturn]
):
    from app.services.scene_feedback import expression_allowed, feedback_choices

    by_session = {row["session_id"]: row for row in sessions}
    by_item = {row["item_id"]: row for row in items}
    by_attempt = {row["attempt_id"]: row for row in attempts}
    by_feedback_item = {}
    for index, row in enumerate(feedback):
        practice = by_session.get(row["session_id"])
        item = by_item.get(row["item_id"])
        answer = by_attempt.get(row["attempt_id"])
        if (
            practice is None
            or practice["purpose"] != "scene"
            or item is None
            or item["session_id"] != row["session_id"]
            or answer is None
            or answer["item_id"] != row["item_id"]
            or item["first_task_attempt_id"] != row["attempt_id"]
            or row["rule_version"] != practice["rule_version"]
            or row["content_hash"] != practice["scene_snapshot"]["content_hash"]
            or row["occurred_at"] < _utc_naive(answer["occurred_at"])
        ):
            reject(
                "scene_feedback",
                index,
                "attempt_id",
                "反馈必须关联同场景、同规则版本的已存首答",
            )
        rules = practice["scene_snapshot"]
        task = rules["tasks"][item["position"] - 1]
        replies = feedback_choices(
            practice["scene_id"], task["task_key"], answer["verdict"], answer["skipped"]
        )
        correction = task["correction"] if answer["verdict"] == "rejected" else None
        if (
            not expression_allowed(
                row, replies, correction, [t["standard"] for t in rules["tasks"]]
            )
            or row["origin"] == "template"
            and row["text"] != replies[0]
        ):
            reject(
                "scene_feedback", index, "text", "回复或纠正不符合冻结任务的受约束材料"
            )
        by_feedback_item[row["item_id"]] = {
            key: value for key, value in row.items() if key not in ("id", "occurred_at")
        }

    # Cached submission responses may include feedback for earlier saved turns.
    # They must not smuggle in unregistered or different expression snapshots.
    for index, answer in enumerate(attempts):
        for view in answer["response"]["session"]["items"]:
            if "feedback" in view and view["feedback"] != by_feedback_item.get(
                view["id"]
            ):
                reject(
                    "scene_attempts",
                    index,
                    "response.session.items.feedback",
                    "回放反馈与持久记录不一致",
                )
