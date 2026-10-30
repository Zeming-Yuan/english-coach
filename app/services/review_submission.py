"""复习提交域：一次「提交复习」的完整语义。

所有会写 FSRS 复习记录的入口（闪卡评分、听写评分）都从这里过，防止逻辑分叉：
1. 查最新 review → FSRS 调度 → 写回全部字段（全库唯一一处写回）
2. 错词追踪（错误增强效应：答错加权、答对减权）
3. 毕业策略：词卡毕业 → 同步建兜底句卡（毫秒级）+ 后台 AI 升级（幂等）

端点只负责：解析请求体 → 调用 submit_review → 组装响应。
"""

import contextvars
import threading
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.card import Card
from app.models.review import Review
from app.services.error_tracking import record_error
from app.services.graduation import (
    ensure_sentence_card,
    is_graduated,
    upgrade_sentence_card,
)
from app.services.scheduler import build_fsrs_card, schedule


class CardNotFoundError(LookupError):
    """卡不存在（端点将其映射为 404）。"""


@dataclass
class ReviewResult:
    """提交一次复习后的可观察结果。"""

    card_id: int
    next_due: datetime
    graduated: bool
    sentence_card_id: int | None = None


def submit_review(
    db: Session,
    card_id: int,
    rating: int,
    *,
    correct: bool | None = None,
) -> ReviewResult:
    """提交一次复习：FSRS 写回 + 错词追踪 + 毕业策略，全部副作用在此处。

    correct: 错词追踪的判分口径。默认按 rating >= 3；
             听写等显式判分的调用方传入以覆盖（防止 rating 与判分不一致）。
    """
    now = datetime.now(timezone.utc)
    card = db.get(Card, card_id)
    if card is None:
        raise CardNotFoundError(card_id)

    # 1. FSRS 写回（请勿在其他文件写 Review 的调度字段：这是唯一写回点）
    review = (
        db.execute(
            select(Review).where(Review.card_id == card.id).order_by(Review.id.desc())
        )
        .scalars()
        .first()
    )
    fsrs_card = build_fsrs_card(review)
    new_card = schedule(fsrs_card, rating, now)

    if review is None:
        review = Review(card_id=card.id, review_count=1)
        db.add(review)
    else:
        review.review_count += 1
    review.state = new_card.state.value
    review.step = new_card.step
    review.due = new_card.due
    review.stability = new_card.stability  # type: ignore[assignment]
    review.difficulty = new_card.difficulty  # type: ignore[assignment]
    review.elapsed_days = (
        (now - review.last_review.replace(tzinfo=timezone.utc)).days
        if review.last_review
        else 0
    )
    review.last_review = now
    review.rating = rating  # 记录评分（复习历史展示）

    # 2. 错词追踪：答错加权、答对减权（错误增强效应）
    record_error(db, card.id, is_correct=correct if correct is not None else rating >= 3)

    # 3. 毕业策略：词卡毕业 → 同步兜底句卡（毫秒级）
    graduated = False
    sentence_card_id = None
    if card.kind == "word" and is_graduated(review):
        sentence = ensure_sentence_card(card, db)
        if sentence is not None:
            graduated = True
            sentence_card_id = sentence.id
    db.commit()
    # 4. AI 复杂句升级放后台线程：复习提交秒回，学习流程不被 AI 卡住。
    #    只有词卡毕业才启动；幂等（已有 AI 句卡则跳过，见 upgrade_sentence_card）。
    if card.kind == "word" and is_graduated(review):
        # 复制请求上下文，让后台线程沿用本应用实例的 AI 配置（ContextVar）。
        ctx = contextvars.copy_context()
        threading.Thread(
            target=ctx.run, args=(upgrade_sentence_card, card.id), daemon=True
        ).start()
    return ReviewResult(
        card_id=card.id,
        next_due=new_card.due,
        graduated=graduated,
        sentence_card_id=sentence_card_id,
    )
