"""练习上下文公开协议（EL-08）。"""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

PracticeAssistance = Literal["first_letter"]


class CreatePracticeIn(BaseModel):
    id: UUID
    purpose: Literal["lesson_check"]
    lesson_id: int = Field(gt=0)
    weak_only: bool = False


class PracticeAttemptIn(BaseModel):
    submission_id: UUID
    answer: str | None = None
    skipped: bool = False

    @model_validator(mode="after")
    def _answer_required(self) -> "PracticeAttemptIn":
        if not self.skipped and not (self.answer or "").strip():
            raise ValueError("未跳过的作答必须提供答案")
        return self


class PracticeAssistanceIn(BaseModel):
    kind: PracticeAssistance
