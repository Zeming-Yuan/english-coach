"""学习提交协议的公开形状（AttemptCommand / AttemptResult）。"""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

Source = Literal[
    "study",
    "lesson",
    "story",
    "card_detail",
    "spelling",
    "quiz",
    "listening",
    "mixed",
    "reinforcement",
    "legacy",
]
Kind = Literal["self_rating", "typed", "choice", "related"]
Assistance = Literal[
    "first_letter", "length", "live_feedback", "answer_audio", "answer_visible"
]
Stage = Literal["main", "reinforcement", "standalone"]


class AttemptCommand(BaseModel):
    """一次学习提交的规范化业务命令（服务端最终解释，不信任额外自评分）。"""

    submission_id: UUID | None = None
    card_id: int
    source: Source = "legacy"
    kind: Kind = "self_rating"
    answer: str | None = None
    rating: Literal[1, 2, 3, 4] | None = None
    assistance: list[Assistance] = Field(default_factory=list)
    skipped: bool = False
    question_token: str | None = None
    session_id: UUID | None = None
    stage: Stage = "standalone"

    @model_validator(mode="after")
    def _validate_combination(self) -> "AttemptCommand":
        if self.kind == "self_rating" and self.rating is None and not self.skipped:
            raise ValueError("self_rating 必须提供 rating")
        if self.kind != "self_rating" and self.rating is not None:
            raise ValueError("只有 self_rating 可以使用 rating，不能用自评分覆盖策略")
        if self.skipped and (self.answer is not None or self.rating is not None):
            raise ValueError("跳过的提交不能同时携带答案或评分")
        return self


class TypingCheckIn(AttemptCommand):
    """输入题提交：user_input 是用户拼写，kind 固定 typed。

    兼容旧调用：未提供 source/submission_id 时按 legacy 记录，不排期。
    """

    kind: Literal["typed"] = "typed"
    user_input: str


class AttemptResult(BaseModel):
    """一次学习提交的已保存结果；重试返回同一份缓存。"""

    committed: Literal[True] = True
    event_id: str
    card_id: int
    correct: bool | None = None
    expected: str | None = None
    scheduled: bool = False
    next_due: str | None = None
    graduated: bool = False
    newly_graduated: bool = False
    sentence_card_id: int | None = None
