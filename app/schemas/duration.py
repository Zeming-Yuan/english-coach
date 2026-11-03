"""Duration command and shared saved-attempt classification."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

DurationKind = Literal["review", "new", "reinforcement"]
DURATION_RULE = "active-v1"


class DurationCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sample_id: UUID
    submission_id: UUID
    kind: DurationKind
    active_ms: int = Field(ge=0, le=9007199254740991, strict=True)


def duration_kind(event: dict) -> str | None:
    """Only real word-card study and reinforcement answers calibrate these tasks."""
    if event["skipped"] or event.get("card_identity") is None:
        return None
    if event["source"] == "reinforcement" and event["kind"] == "typed":
        return "reinforcement"
    if event["source"] != "study" or event["kind"] != "self_rating":
        return None
    before = event.get("before") or {}
    return (
        "new"
        if before.get("last_review") is None and before.get("stability") is None
        else "review"
    )
