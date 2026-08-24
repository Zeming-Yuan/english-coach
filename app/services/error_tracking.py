"""错词追踪服务：错误增强效应（Errorful Learning）。

规则：
- rating <= 2 或判分答错 → error_count + 1（加权）
- rating >= 3 或判分答对 → error_count - 1（减权），归零即删
触发点：/api/reviews、/api/listening/score、/api/typing/check
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.error_card import ErrorCard


def record_error(db: Session, card_id: int, is_correct: bool) -> int:
    """记录对错，返回该卡当前 error_count（0 = 已清权）。"""
    row = (
        db.execute(select(ErrorCard).where(ErrorCard.card_id == card_id))
        .scalars()
        .first()
    )
    if is_correct:
        if row:
            row.error_count -= 1
            if row.error_count <= 0:
                db.delete(row)
            return 0
        return 0
    # 答错：加权
    if row:
        row.error_count += 1
        return row.error_count
    db.add(ErrorCard(card_id=card_id, error_count=1))
    return 1
