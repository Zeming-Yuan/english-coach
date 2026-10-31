"""回忆证据：只从当前内容修订的真实学习事件计算。

规则（EL-02）：同一学习日只取首个独立 typed 作答；至少两个不同学习日、
首答独立正确且相隔至少 24 小时，才视为回忆已有证据。最近一次独立首答
错误使当前证据待巩固；超过 30 天提示待复测。辅助、识别、自评、跳过与
迁移基线不满足独立回忆门槛。
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import literal_column, or_, select
from sqlalchemy.orm import Session

from app.models.review_event import ReviewEvent
from app.runtime import Runtime
from app.services.content_revisions import get_content_revision
from app.services.learning import has_incomplete_history

RULE_VERSION = "el02-v1"
MIN_SPAN_SECONDS = 24 * 60 * 60
STALE_AFTER_SECONDS = 30 * 24 * 60 * 60


def recall_status(
    day_count: int,
    span_seconds: int,
    last_correct: bool | None,
    age_seconds: int,
    history_complete: bool,
) -> str:
    if not history_complete:
        return "history_incomplete"
    if last_correct is False:
        return "weak"
    if day_count < 2 or span_seconds < MIN_SPAN_SECONDS:
        return "insufficient"
    if age_seconds > STALE_AFTER_SECONDS:
        return "stale"
    return "verified"


def _aware_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _no_unlinked_events(db: Session, card_id: int) -> bool:
    unlinked = db.execute(
        select(ReviewEvent.id)
        .where(
            ReviewEvent.card_id == card_id,
            or_(
                ReviewEvent.card_identity.is_(None),
                ReviewEvent.card_revision.is_(None),
            ),
        )
        .limit(1)
    ).first()
    return unlinked is None


def _first_independent_per_day(db: Session, card_id: int, revision: dict):
    # 先按学习日取首个 typed 作答（无论是否辅助/跳过），再要求它独立。
    # 否则“先辅助、后同日重试”会被误算成当天的独立首答。
    rows = db.execute(
        select(ReviewEvent)
        .where(
            ReviewEvent.card_id == card_id,
            ReviewEvent.kind == "typed",
            ReviewEvent.source != "legacy",
            ReviewEvent.card_identity == revision["identity"],
            ReviewEvent.card_revision == revision["version"],
        )
        .order_by(
            ReviewEvent.occurred_at,
            literal_column("review_events.rowid"),
        )
    ).scalars()
    first_by_day = {}
    for row in rows:
        first_by_day.setdefault(row.learning_day, row)
    return [
        row
        for row in first_by_day.values()
        if not row.assistance and not row.skipped and row.correct is not None
    ]


def _dimension(status: str, count: int, last_verified_at: str | None) -> dict:
    return {
        "status": status,
        "count": count,
        "last_verified_at": last_verified_at,
    }


def evidence_summary(
    db: Session,
    card_id: int,
    runtime: Runtime,
    *,
    incomplete_history: bool | None = None,
) -> dict:
    revision = get_content_revision(db, "card", card_id)
    if incomplete_history is None:
        incomplete_history = has_incomplete_history(db, card_id)
    history_complete = not incomplete_history and _no_unlinked_events(db, card_id)
    samples = _first_independent_per_day(db, card_id, revision)

    failure_index = max(
        (index for index, sample in enumerate(samples) if sample.correct is False),
        default=-1,
    )
    successes = [
        sample for sample in samples[failure_index + 1 :] if sample.correct is True
    ]
    day_count = len({sample.learning_day for sample in successes})
    span_seconds = 0
    if successes:
        span_seconds = int(
            (
                _aware_utc(successes[-1].occurred_at)
                - _aware_utc(successes[0].occurred_at)
            ).total_seconds()
        )
    # 历史成功仍可查看：最近一次正确样本不因后来的失败而被抹掉。
    correct_samples = [sample for sample in samples if sample.correct is True]
    last_verified_at = None
    age_seconds = 0
    if correct_samples:
        last_at = _aware_utc(correct_samples[-1].occurred_at)
        age_seconds = max(
            0, int((runtime.clock.now().astimezone(UTC) - last_at).total_seconds())
        )
        last_verified_at = last_at.isoformat()

    status = recall_status(
        day_count,
        span_seconds,
        samples[-1].correct if samples else None,
        age_seconds,
        history_complete,
    )
    unavailable = _dimension("insufficient", 0, None)
    return {
        "revision": revision,
        "rule_version": RULE_VERSION,
        "recall": _dimension(status, len(samples), last_verified_at),
        # 延迟保持与应用证据尚未引入；显式无证据，不偷读毕业字段。
        "retention": dict(unavailable),
        "application": dict(unavailable),
    }


__all__ = ["RULE_VERSION", "evidence_summary", "recall_status"]
