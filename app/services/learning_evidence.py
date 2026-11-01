"""回忆证据：只从当前内容修订的真实学习事件计算。

规则（EL-02）：同一学习日先取首个 typed 作答，只有它未辅助、未跳过且已判分
才成为独立样本；至少两个不同学习日、首答独立正确且相隔至少 24 小时，才视为
回忆已有证据。最近一次独立首答错误使当前证据待巩固；超过 30 天提示待复测。
识别、自评、跳过与迁移基线不满足独立回忆门槛。
"""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime

from sqlalchemy import literal_column, or_, select
from sqlalchemy.orm import Session

from app.models.card import Card
from app.models.review_baseline import ReviewBaseline
from app.models.review_event import ReviewEvent
from app.runtime import Runtime
from app.services.content_revisions import content_revision_map, get_content_revision
from app.services.learning import has_incomplete_history

RULE_VERSION = "el02-v1"
MIN_SPAN_SECONDS = 24 * 60 * 60
STALE_AFTER_SECONDS = 30 * 24 * 60 * 60
EVIDENCE_STATUSES = ("verified", "weak", "stale", "history_incomplete", "insufficient")


def evidence_label(status: str) -> str:
    """所有进展入口共用的证据标签；未知状态保守降级为证据不足。"""
    return {
        "verified": "独立回忆已有证据",
        "weak": "仍需巩固",
        "stale": "历史证据，待复测",
        "history_incomplete": "历史依据不完整",
        "insufficient": "独立证据不足",
    }.get(status, "独立证据不足")


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


def _samples_from_events(events, revision: dict):
    # 先按学习日取首个 typed 作答（无论是否辅助/跳过），再要求它独立。
    # 否则“先辅助、后同日重试”会被误算成当天的独立首答。
    first_by_day = {}
    for row in events:
        if (
            row.kind != "typed"
            or row.source == "legacy"
            or row.card_identity != revision["identity"]
            or row.card_revision != revision["version"]
        ):
            continue
        first_by_day.setdefault(row.learning_day, row)
    return [
        row
        for row in first_by_day.values()
        if not row.assistance and not row.skipped and row.correct is not None
    ]


def _dimension(status: str, count: int, last_verified_at: str | None) -> dict:
    return {
        "status": status,
        "label": evidence_label(status),
        "count": count,
        "last_verified_at": last_verified_at,
    }


def _summarize(
    revision: dict, samples, history_complete: bool, runtime: Runtime
) -> dict:
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
        "progress_label": evidence_label(status),
        "recall": _dimension(status, len(samples), last_verified_at),
        # 延迟保持与应用证据尚未引入；显式无证据，不偷读毕业字段。
        "retention": dict(unavailable),
        "application": dict(unavailable),
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
    events = db.execute(
        select(ReviewEvent)
        .where(ReviewEvent.card_id == card_id)
        .order_by(ReviewEvent.occurred_at, literal_column("review_events.rowid"))
    ).scalars()
    return _summarize(
        revision, _samples_from_events(events, revision), history_complete, runtime
    )


def bulk_evidence_summaries(
    db: Session, card_ids, runtime: Runtime
) -> dict[int, dict]:
    """批量证据摘要：词表/首页/统计共用一次事件与历史读取。"""
    ids = list(dict.fromkeys(card_ids))
    if not ids:
        return {}
    revisions = content_revision_map(db, "card", ids)
    events_by_card: dict[int, list[ReviewEvent]] = defaultdict(list)
    for event in db.execute(
        select(ReviewEvent)
        .where(ReviewEvent.card_id.in_(ids))
        .order_by(
            ReviewEvent.card_id,
            ReviewEvent.occurred_at,
            literal_column("review_events.rowid"),
        )
    ).scalars():
        events_by_card[event.card_id].append(event)
    baseline_ids = set(
        db.scalars(
            select(ReviewBaseline.card_id).where(ReviewBaseline.card_id.in_(ids))
        )
    )
    summaries = {}
    for card_id in ids:
        revision = revisions.get(card_id)
        if revision is None:
            raise LookupError(f"缺少内容修订身份：card:{card_id}")
        events = events_by_card.get(card_id, [])
        history_complete = (
            card_id not in baseline_ids
            and not any(event.source == "legacy" for event in events)
            and not any(
                event.card_identity is None or event.card_revision is None
                for event in events
            )
        )
        summaries[card_id] = _summarize(
            revision,
            _samples_from_events(events, revision),
            history_complete,
            runtime,
        )
    return summaries


def evidence_overview(summaries: dict[int, dict]) -> dict:
    """聚合计数与样本量；不替代题型正确率。"""
    counts = {status: 0 for status in EVIDENCE_STATUSES}
    samples = 0
    latest = None
    for summary in summaries.values():
        recall = summary["recall"]
        counts[recall["status"]] = counts.get(recall["status"], 0) + 1
        samples += recall["count"]
        if recall["last_verified_at"] and (
            latest is None or recall["last_verified_at"] > latest
        ):
            latest = recall["last_verified_at"]
    return {
        "counts": counts,
        "labels": {status: evidence_label(status) for status in EVIDENCE_STATUSES},
        "samples": samples,
        "latest_at": latest,
    }


def word_evidence_overview(db: Session, runtime: Runtime) -> dict:
    word_ids = list(db.scalars(select(Card.id).where(Card.kind == "word")))
    return evidence_overview(bulk_evidence_summaries(db, word_ids, runtime))


__all__ = [
    "EVIDENCE_STATUSES",
    "RULE_VERSION",
    "bulk_evidence_summaries",
    "evidence_label",
    "evidence_overview",
    "evidence_summary",
    "recall_status",
    "word_evidence_overview",
]
