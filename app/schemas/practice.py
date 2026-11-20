"""练习上下文公开协议（EL-08）。"""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from app.schemas.learning import ContactRevision

PracticeAssistance = Literal["first_letter", "answer_visible", "hint", "answer_audio"]


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
    purpose: Literal[
        "lesson_check", "delayed_check", "targeted", "story_check", "scene", "expansion"
    ]
    scene_id: str | None = None
    lesson_id: int | None = Field(default=None, gt=0)
    story_id: int | None = Field(default=None, gt=0)
    version_id: UUID | None = None
    addition_operation_id: UUID | None = None
    source_card_id: int | None = Field(default=None, gt=0)
    source_revision: ContactRevision | None = None
    weak_only: bool = False
    card_ids: list[int] = Field(default_factory=list, max_length=3)
    targets: list[PracticeTarget] = Field(default_factory=list, max_length=3)
    window: Literal["day", "week"] | None = None
    pending_contact_ids: list[str] = Field(default_factory=list, max_length=1000)

    @model_validator(mode="after")
    def _purpose_fields(self) -> "CreatePracticeIn":
        if self.purpose == "scene":
            if not self.scene_id or any(
                (
                    self.lesson_id,
                    self.story_id,
                    self.version_id,
                    self.window,
                    self.weak_only,
                    self.targets,
                    self.card_ids,
                    self.pending_contact_ids,
                )
            ):
                raise ValueError("场景需要 scene_id 且不能混合其他练习用途")
        elif self.scene_id is not None:
            raise ValueError("只有场景可以指定 scene_id")
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
        if self.purpose == "story_check":
            if (
                self.story_id is None
                or self.version_id is None
                or self.lesson_id is not None
                or self.window is not None
                or self.weak_only
                or self.targets
                or self.card_ids
                or self.pending_contact_ids
            ):
                raise ValueError("读后检查需要故事和版本，不能指定其他练习目标")
        elif self.story_id is not None or self.version_id is not None:
            raise ValueError("只有读后检查可以指定故事版本")
        expansion = (
            self.addition_operation_id,
            self.source_card_id,
            self.source_revision,
        )
        if self.purpose == "expansion":
            if (
                not all(expansion)
                or len(self.targets) != 1
                or any(
                    (
                        self.lesson_id,
                        self.window,
                        self.weak_only,
                        self.pending_contact_ids,
                    )
                )
            ):
                raise ValueError("扩展练习需要已加入的单一目标和来源修订")
        elif any(expansion):
            raise ValueError("只有扩展练习可指定加入记录与来源修订")
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
    expansion_target_id: int | None = Field(default=None, gt=0)
    answer: str | None = Field(default=None, max_length=2000)
    client_assistance: list[PracticeAssistance] = Field(default_factory=list)
    skipped: bool = False
    pending_contact_ids: list[str] = Field(default_factory=list, max_length=1000)

    @model_validator(mode="after")
    def _answer_required(self) -> "PracticeAttemptIn":
        if not self.skipped and not (self.answer or "").strip():
            raise ValueError("未跳过的作答必须提供答案")
        return self


class PracticeAssistanceIn(BaseModel):
    kind: PracticeAssistance
