"""Save observations in their own idempotent transaction, after answer confirmation."""

from datetime import UTC

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models.card import Card
from app.models.practice_duration import PracticeDuration
from app.models.review_event import ReviewEvent
from app.runtime import Runtime
from app.schemas.duration import DURATION_RULE, DurationCommand, duration_kind
from app.services.write_transaction import run_write


def record_duration(db: Session, payload: DurationCommand, runtime: Runtime) -> dict:
    def operation(session: Session) -> dict:
        sample_id, submission_id = str(payload.sample_id), str(payload.submission_id)
        existing = session.scalar(
            select(PracticeDuration).where(
                or_(
                    PracticeDuration.sample_id == sample_id,
                    PracticeDuration.submission_id == submission_id,
                )
            )
        )
        if existing is not None:
            if (
                existing.sample_id,
                existing.submission_id,
                existing.kind,
                existing.active_ms,
            ) != (sample_id, submission_id, payload.kind, payload.active_ms):
                raise HTTPException(409, "时长标识或作答已用于不同记录")
            return {"committed": True, "sample_id": existing.sample_id}
        event = session.scalar(
            select(ReviewEvent).where(ReviewEvent.submission_id == submission_id)
        )
        if event is None:
            raise HTTPException(404, "关联作答未保存或词卡已删除")
        card = session.get(Card, event.card_id)
        event_data = {
            key: getattr(event, key)
            for key in ("skipped", "card_identity", "source", "kind", "before")
        }
        if (
            card is None
            or card.kind != "word"
            or duration_kind(event_data) != payload.kind
        ):
            raise HTTPException(422, "时长类别与真实词卡作答不一致或记录不可靠")
        session.add(
            PracticeDuration(
                sample_id=sample_id,
                submission_id=submission_id,
                kind=payload.kind,
                active_ms=payload.active_ms,
                rule_version=DURATION_RULE,
                occurred_at=runtime.clock.now().astimezone(UTC).replace(tzinfo=None),
            )
        )
        return {"committed": True, "sample_id": sample_id}

    return run_write(db, operation)
