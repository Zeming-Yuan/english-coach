"""复习提交域适配器：旧调用（闪卡评分、听写评分）仍从这里进入统一写模块。

Review 的排期写回、错词追踪、毕业策略与追加事件都收敛到
app.services.learning；本文件只保留旧函数签名与结果形状。
"""

from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.runtime import Runtime, SystemClock
from app.schemas.learning import AttemptCommand, AttemptResult
from app.services.graduation import upgrade_sentence_card
from app.services.learning import CardNotFoundError, submit_attempt

__all__ = ["CardNotFoundError", "ReviewResult", "submit_command", "submit_review"]


@dataclass
class ReviewResult:
    """提交一次复习后的可观察结果。"""

    card_id: int
    next_due: datetime
    graduated: bool
    sentence_card_id: int | None = None


def submit_command(db: Session, cmd: AttemptCommand, runtime: Runtime) -> AttemptResult:
    """新协议入口适配：保留 upgrade_sentence_card 作为可替换的后台升级接缝。"""
    return submit_attempt(db, cmd, runtime, upgrade=upgrade_sentence_card)


def submit_review(
    db: Session,
    card_id: int,
    rating: int,
    *,
    correct: bool | None = None,
    runtime: Runtime | None = None,
) -> ReviewResult:
    """提交一次复习：统一原子写模块的旧入口适配。

    correct: 错词追踪的判分口径。默认按 rating >= 3；
             听写等显式判分的调用方传入以覆盖（防止 rating 与判分不一致）。
    """
    command = AttemptCommand(
        card_id=card_id,
        rating=rating,
        kind="self_rating",
        source="legacy",
    )
    result = submit_attempt(
        db,
        command,
        runtime or Runtime(SystemClock()),
        correct_override=correct,
        upgrade=upgrade_sentence_card,
    )
    next_due = (
        datetime.fromisoformat(result.next_due)
        if result.next_due is not None
        else datetime.now(timezone.utc)
    )
    return ReviewResult(
        card_id=result.card_id,
        next_due=next_due,
        graduated=result.graduated,
        sentence_card_id=result.sentence_card_id,
    )
