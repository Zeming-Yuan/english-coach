"""真实应用内记录间隔：候选、冻结依据与首测聚合。"""

from collections.abc import Callable
from datetime import UTC, datetime
from typing import NoReturn
from uuid import uuid4

from sqlalchemy import literal_column, select
from sqlalchemy.orm import Session

from app.models.card import Card
from app.models.error_card import ErrorCard
from app.models.learning_contact import LearningContact
from app.models.practice import PracticeItem, PracticeSession
from app.models.review import Review
from app.models.review_event import ReviewEvent
from app.runtime import Runtime
from app.services.content_revisions import get_content_revision
from app.services.statistics import learning_day


def window_for_gap(seconds: int) -> str:
    if 86400 <= seconds < 259200:
        return "day"
    if 604800 <= seconds < 1209600:
        return "week"
    return "other"


def utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def latest_basis(db: Session, card_id: int, revision: dict) -> dict | None:
    contacts = list(
        db.scalars(
            select(LearningContact).where(
                LearningContact.card_id == card_id,
                LearningContact.card_identity == revision["identity"],
                LearningContact.card_revision == revision["version"],
            )
        )
    )
    events = list(
        db.scalars(
            select(ReviewEvent).where(
                ReviewEvent.card_id == card_id,
                ReviewEvent.card_identity == revision["identity"],
                ReviewEvent.card_revision == revision["version"],
                ReviewEvent.skipped.is_(False),
            )
        )
    )
    # 必须同时有当前修订的真实学习依据与明确接触记录；旧基线不补造。
    # legacy 不进入独立证据，但新保存的非跳过作答仍保守重置相关接触时间。
    if not contacts or not events:
        return None
    anchors = [(utc(c.occurred_at), "contact", c.submission_id) for c in contacts]
    anchors += [(utc(e.occurred_at), "event", e.id) for e in events]
    at, kind, identity = max(anchors)
    return {
        "anchor_at": at.isoformat(),
        "anchor_kind": kind,
        "anchor_id": identity,
        "integrity": "confirmed",
    }


def delayed_items(
    db: Session,
    window: str,
    pending: list[str],
    runtime: Runtime,
    *,
    issued_at: datetime | None = None,
    target_ids: list[int] | None = None,
) -> list[dict]:
    if pending:
        return []  # 未确认接触只能降低资格，不能提供时间依据。
    now = issued_at or runtime.clock.now().astimezone(UTC)
    weak_ids = set(
        db.scalars(select(ErrorCard.card_id).where(ErrorCard.error_count > 0))
    )
    processed = {
        (item.card_id, event.learning_day, result["window"])
        for item, event, result in first_results(db)
    }
    candidates = []
    for card, review in db.execute(
        select(Card, Review)
        .outerjoin(Review, Review.card_id == Card.id)
        .where(Card.kind == "word")
    ):
        if target_ids is not None and card.id not in target_ids:
            continue
        if not (card.meaning or "").strip():
            continue
        revision = get_content_revision(db, "card", card.id)
        if (card.id, learning_day(now, runtime.learning_timezone), window) in processed:
            continue
        basis = latest_basis(db, card.id, revision)
        if basis is None:
            continue
        gap = int((now - datetime.fromisoformat(basis["anchor_at"])).total_seconds())
        if window_for_gap(gap) != window:
            continue
        candidates.append(
            (
                review is None or utc(review.due) > now,
                card.id not in weak_ids,
                basis["anchor_at"],
                revision["identity"],
                card,
                revision,
                basis,
                gap,
            )
        )
    candidates.sort(key=lambda row: row[:4])
    return [
        {
            "item_id": str(uuid4()),
            "card_id": card.id,
            "card_identity": revision["identity"],
            "card_revision": revision["version"],
            "prompt": card.meaning,
            "kind": "typed",
            "position": position,
            "retention_basis": {**basis, "gap_seconds": gap, "window": window},
        }
        for position, (_, _, _, _, card, revision, basis, gap) in enumerate(
            candidates[:3], 1
        )
    ]


def classify_result(
    basis: dict | None, accepted_at: datetime, pending: list[str]
) -> dict:
    if basis is None or pending:
        return {
            "anchor_at": basis["anchor_at"] if basis else None,
            "gap_seconds": None,
            "window": "other",
            "integrity": "incomplete",
        }
    gap = max(
        0,
        int(
            (
                utc(accepted_at) - datetime.fromisoformat(basis["anchor_at"])
            ).total_seconds()
        ),
    )
    return {**basis, "gap_seconds": gap, "window": window_for_gap(gap)}


def first_results(
    db: Session, card_id: int | None = None
) -> list[tuple[PracticeItem, ReviewEvent, dict]]:
    """先取每词/修订/学习日/实际窗口首处理，再区分独立、辅助、跳过。"""
    query = (
        select(PracticeItem, ReviewEvent)
        .join(PracticeSession, PracticeSession.session_id == PracticeItem.session_id)
        .join(ReviewEvent, ReviewEvent.id == PracticeItem.first_event_id)
        .where(PracticeSession.purpose == "delayed_check")
        .order_by(ReviewEvent.occurred_at, literal_column("review_events.rowid"))
    )
    if card_id is not None:
        query = query.where(PracticeItem.card_id == card_id)
    first = {}
    for item, event in db.execute(query):
        if not item.retention_result:
            continue
        key = (
            item.card_id,
            item.card_identity,
            item.card_revision,
            event.learning_day,
            item.retention_result["window"],
        )
        first.setdefault(key, (item, event, item.retention_result))
    return list(first.values())


def retention_overview(db: Session, revisions: dict[int, dict] | None = None) -> dict:
    overview = {
        window: {
            "successes": 0,
            "count": 0,
            "assisted": 0,
            "skipped": 0,
            "covered": 0,
            "incomplete": 0,
            "gap_seconds": [],
        }
        for window in ("day", "week", "other")
    }
    covered = {window: set() for window in overview}
    for item, event, result in first_results(db):
        if revisions is not None and revisions.get(item.card_id) != {
            "identity": item.card_identity,
            "version": item.card_revision,
        }:
            continue
        row = overview[result["window"]]
        covered[result["window"]].add(item.card_id)
        if result["gap_seconds"] is not None:
            row["gap_seconds"].append(result["gap_seconds"])
        if result["integrity"] != "confirmed":
            row["incomplete"] += 1
        if event.skipped:
            row["skipped"] += 1
        elif event.assistance:
            row["assisted"] += 1
        elif result["integrity"] == "confirmed" and event.correct is not None:
            row["count"] += 1
            row["successes"] += int(event.correct)
    for window, row in overview.items():
        row["covered"] = len(covered[window])
    return overview


def retention_dimensions(
    db: Session, revisions: dict[int, dict], runtime: Runtime
) -> dict[int, dict]:
    """批量读取保持证据；事件保存次序也用于同时间戳的新失败判断。"""
    rows_by_card = {}
    for item, event, result in first_results(db):
        rows_by_card.setdefault(item.card_id, []).append((item, event, result))
    independent_by_card = {}
    for event in db.scalars(
        select(ReviewEvent)
        .where(
            ReviewEvent.card_id.in_(list(revisions)),
            ReviewEvent.kind == "typed",
            ReviewEvent.source != "legacy",
            ReviewEvent.skipped.is_(False),
            ReviewEvent.assistance == [],
        )
        .order_by(ReviewEvent.occurred_at, literal_column("review_events.rowid"))
    ):
        revision = revisions[event.card_id]
        if (
            event.card_identity == revision["identity"]
            and event.card_revision == revision["version"]
        ):
            independent_by_card.setdefault(event.card_id, []).append(event)
    summaries = {}
    for card_id, revision in revisions.items():
        samples = [
            event
            for item, event, result in rows_by_card.get(card_id, [])
            if item.card_identity == revision["identity"]
            and item.card_revision == revision["version"]
            and result["window"] == "week"
            and result["integrity"] == "confirmed"
            and not event.skipped
            and not event.assistance
            and event.correct is not None
        ]
        successes = [event for event in samples if event.correct is True]
        last_success = successes[-1] if successes else None
        last = utc(last_success.occurred_at) if last_success else None
        independent = independent_by_card.get(card_id, [])
        success_index = next(
            (
                index
                for index, event in enumerate(independent)
                if last_success and event.id == last_success.id
            ),
            -1,
        )
        failed_since = last_success is not None and any(
            event.correct is False for event in independent[success_index + 1 :]
        )
        status = "insufficient"
        if (samples and samples[-1].correct is False) or failed_since:
            status = "weak"
        elif last:
            status = (
                "stale"
                if (runtime.clock.now().astimezone(UTC) - last).total_seconds()
                > 2592000
                else "verified"
            )
        summaries[card_id] = {
            "status": status,
            "label": {
                "verified": "长间隔保持已有证据",
                "weak": "长间隔保持仍需巩固",
                "stale": "历史保持证据，待复测",
            }.get(status, "独立证据不足"),
            "count": len(samples),
            "last_verified_at": last.isoformat() if last else None,
        }
    return summaries


def validate_retention_graph(
    sessions, items, events, contacts, reject: Callable[..., NoReturn]
) -> None:
    """恢复前验证时间依据的真实引用；不接受自造的长间隔标签。"""
    contact_rows = {row["submission_id"]: row for row in contacts}
    for index, practice in enumerate(sessions.values()):
        delayed = practice["purpose"] == "delayed_check"
        if delayed != (practice["window"] is not None) or (
            practice["purpose"] == "lesson_check"
        ) != (practice["lesson_id"] is not None):
            reject("practice_sessions", index, "purpose", "用途与课程/窗口不一致")
    for index, item in enumerate(items):
        practice = sessions[item["session_id"]]
        basis, result = item["retention_basis"], item["retention_result"]
        if practice["purpose"] != "delayed_check":
            if basis is not None or result is not None:
                reject(
                    "practice_items", index, "retention_basis", "课程短测不能带延迟依据"
                )
            continue
        if (
            basis is None
            or basis["window"] != practice["window"]
            or basis["integrity"] != "confirmed"
        ):
            reject("practice_items", index, "retention_basis", "缺少冻结的有效窗口依据")
        event = events.get(item["first_event_id"])
        if (result is not None) != (event is not None):
            reject("practice_items", index, "retention_result", "结果必须关联首答事件")
        for record, at, field in [
            (basis, item["created_at"], "retention_basis"),
            (result, event["occurred_at"] if event else None, "retention_result"),
        ]:
            if record is None:
                continue
            if record["integrity"] == "incomplete":
                if record["window"] != "other" or record["gap_seconds"] is not None:
                    reject("practice_items", index, field, "不完整依据不能生成窗口样本")
                continue
            anchor = (events if record["anchor_kind"] == "event" else contact_rows).get(
                record["anchor_id"]
            )
            if (
                anchor is None
                or anchor["card_id"] != item["card_id"]
                or anchor["card_identity"] != item["card_identity"]
                or anchor["card_revision"] != item["card_revision"]
                or anchor.get("skipped", False)
            ):
                reject("practice_items", index, field, "间隔锚点与目标修订不一致")
            try:
                anchor_at = datetime.fromisoformat(record["anchor_at"])
                gap = int((utc(at) - utc(anchor_at)).total_seconds())
            except (ValueError, TypeError):
                reject("practice_items", index, field, "间隔时间无效")
            if (
                utc(anchor_at) != utc(anchor["occurred_at"])
                or gap < 0
                or gap != record["gap_seconds"]
                or window_for_gap(gap) != record["window"]
            ):
                reject("practice_items", index, field, "间隔与真实记录不一致")
            if field == "retention_result":
                newer = [
                    row
                    for row in [*contacts, *events.values()]
                    if row["card_id"] == item["card_id"]
                    and row["card_identity"] == item["card_identity"]
                    and row["card_revision"] == item["card_revision"]
                    and not row.get("skipped", False)
                    and utc(anchor_at) < utc(row["occurred_at"]) < utc(at)
                ]
                if newer:
                    reject(
                        "practice_items", index, field, "忽略了提交前较新的接触或作答"
                    )
            if event and (
                event["card_identity"] != item["card_identity"]
                or event["card_revision"] != item["card_revision"]
            ):
                reject("practice_items", index, field, "首答事件修订与题目不一致")
            if event and record["anchor_id"] == event["id"]:
                reject("practice_items", index, field, "本次作答不能作为自己的锚点")
