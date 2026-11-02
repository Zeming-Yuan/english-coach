"""练习上下文公开协议（EL-08）。"""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

PracticeAssistance = Literal["first_letter"]


class PracticeTarget(BaseModel):
    card_id: int = Field(gt=0)
    revision: dict

    @model_validator(mode="after")
    def _revision(self):
        identity = UUID(str(self.revision.get("identity", "")))
        version = self.revision.get("version")
        if type(version) is not int or version < 1:
            raise ValueError("目标修订无效")
        self.revision = {"identity": str(identity), "version": version}
        return self


class CreatePracticeIn(BaseModel):
    id: UUID
    purpose: Literal["lesson_check", "delayed_check", "targeted"]
    lesson_id: int | None = Field(default=None, gt=0)
    weak_only: bool = False
    card_ids: list[int] = Field(default_factory=list, max_length=3)
    targets: list[PracticeTarget] = Field(default_factory=list, max_length=3)
    window: Literal["day", "week"] | None = None
    pending_contact_ids: list[str] = Field(default_factory=list, max_length=1000)

    @model_validator(mode="after")
    def _purpose_fields(self) -> "CreatePracticeIn":
        if self.purpose == "lesson_check" and (
            self.lesson_id is None
            or self.window is not None
            or self.pending_contact_ids
        ):
            raise ValueError("课程短测需要课程且不能指定延迟窗口")
        if self.purpose == "delayed_check" and (
            self.window is None or self.lesson_id is not None or self.weak_only
        ):
            raise ValueError("延迟回测需要窗口且不能指定课程或薄弱项")
        ids = [target.card_id for target in self.targets]
        if self.card_ids != ids or len(set(ids)) != len(ids):
            raise ValueError("指定目标与词集合不一致或重复")
        if self.purpose == "lesson_check" and self.targets:
            raise ValueError("课程短测不能指定其他目标")
        if self.purpose == "targeted" and (
            self.lesson_id is not None or self.window is not None or self.weak_only
        ):
            raise ValueError("专项练习不能指定课程或窗口")
        return self


class PracticeAttemptIn(BaseModel):
    submission_id: UUID
    answer: str | None = None
    skipped: bool = False
    pending_contact_ids: list[str] = Field(default_factory=list, max_length=1000)

    @model_validator(mode="after")
    def _answer_required(self) -> "PracticeAttemptIn":
        if not self.skipped and not (self.answer or "").strip():
            raise ValueError("未跳过的作答必须提供答案")
        return self


class PracticeAssistanceIn(BaseModel):
    kind: PracticeAssistance
