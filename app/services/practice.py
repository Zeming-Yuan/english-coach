"""持久练习上下文（EL-08）：课程短测的冻结题目、帮助与首答结果。

轮次与题目只引用真实学习事件作为结果；题目不向前端暴露未作答的答案、
长度或目标音频。生成/提交失败不留下半轮或重复排期。
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.card import Card
from app.models.lesson import Lesson
from app.models.practice import PracticeItem, PracticeSession
from app.models.review_event import ReviewEvent
from app.runtime import Runtime
from app.schemas.learning import AttemptCommand
from app.services.contacts import merge_assistance
from app.services.content_revisions import (
    content_revision_map,
    get_content_revision,
    lesson_word_cards,
)
from app.services.learning import (
    apply_attempt_in_transaction,
    start_pending_upgrade,
)
from app.services.learning_evidence import bulk_evidence_summaries
from app.services.lesson_progress import record_lesson_check
from app.services.retention import classify_result, delayed_items, latest_basis
from app.services.write_transaction import run_write

RULE_VERSION = "el08-v1"
MAX_ITEMS = 3
PURPOSES: dict[str, Callable] = {}


class PracticeNotFoundError(LookupError):
    """轮次、题目或目标词卡不存在。"""


class PracticeLessonNotFoundError(LookupError):
    """课程不存在。"""


class PracticeConflictError(RuntimeError):
    """轮次/提交标识或内容身份冲突。"""


class PracticeStaleError(RuntimeError):
    """题目冻结的内容修订已过期。"""


class PracticeUnavailableError(RuntimeError):
    """轮次不可作答或输入不合法。"""


def lesson_check_status(results: list[dict]) -> str:
    if not results:
        return "unavailable"
    if any(not row.get("processed", False) for row in results):
        return "incomplete"
    if all(row.get("skipped", False) for row in results):
        # 整轮跳过是未完成，不是待巩固或通过。
        return "incomplete"
    if all(
        row.get("correct") is True
        and not row.get("assistance")
        and not row.get("skipped", False)
        for row in results
    ):
        return "passed"
    return "weak"


def register_purpose(name: str, selector: Callable) -> None:
    if name in PURPOSES:
        raise ValueError(f"练习用途已登记：{name}")
    PURPOSES[name] = selector


def _lesson_words(db: Session, lesson: Lesson) -> list[dict]:
    result = []
    for card in lesson_word_cards(db, lesson):
        meaning = (card.get("meaning") or "").strip()
        if not meaning:
            continue
        result.append(
            {
                "card_id": card["id"],
                "meaning": meaning,
                "revision": card["content_revision"],
            }
        )
    return result


def _latest_weak_card_ids(db: Session, lesson_id: int) -> set[int]:
    rows = (
        db.execute(
            select(PracticeItem)
            .join(
                PracticeSession,
                PracticeItem.session_id == PracticeSession.session_id,
            )
            .where(
                PracticeSession.lesson_id == lesson_id,
                PracticeItem.first_event_id.is_not(None),
            )
            .order_by(PracticeSession.created_at.desc(), PracticeItem.position)
        )
        .scalars()
        .all()
    )
    latest: dict[int, PracticeItem] = {}
    for row in rows:
        latest.setdefault(row.card_id, row)
    events = {
        event.id: event
        for event in db.execute(
            select(ReviewEvent).where(
                ReviewEvent.id.in_(
                    [
                        row.first_event_id
                        for row in latest.values()
                        if row.first_event_id
                    ]
                )
            )
        ).scalars()
    }
    weak = set()
    for card_id, row in latest.items():
        event = events.get(row.first_event_id) if row.first_event_id else None
        if (
            event is None
            or event.correct is not True
            or event.skipped
            or (event.assistance or [])
        ):
            weak.add(card_id)
    return weak


def _lesson_check_items(
    db: Session, lesson_id: int, weak_only: bool, runtime: Runtime
) -> list[dict]:
    lesson = db.get(Lesson, lesson_id)
    if lesson is None:
        raise PracticeLessonNotFoundError("课程不存在")
    entries = _lesson_words(db, lesson)
    unique = []
    seen_cards = set()
    for entry in entries:
        if entry["card_id"] in seen_cards:
            continue
        seen_cards.add(entry["card_id"])
        unique.append(entry)
    entries = unique
    if weak_only:
        weak_ids = _latest_weak_card_ids(db, lesson_id)
        entries = [entry for entry in entries if entry["card_id"] in weak_ids]
    else:
        summaries = bulk_evidence_summaries(
            db, [entry["card_id"] for entry in entries], runtime
        )
        entries.sort(
            key=lambda entry: (
                summaries[entry["card_id"]]["recall"]["count"],
                entry["card_id"],
            )
        )
    selected = entries[:MAX_ITEMS]
    return [
        {
            "item_id": str(uuid4()),
            "card_id": entry["card_id"],
            "card_identity": entry["revision"]["identity"],
            "card_revision": entry["revision"]["version"],
            "prompt": entry["meaning"],
            "kind": "typed",
            "position": position,
        }
        for position, entry in enumerate(selected, 1)
    ]


register_purpose("lesson_check", _lesson_check_items)
register_purpose("delayed_check", delayed_items)


def _session_by_public(session: Session, session_id) -> PracticeSession:
    row = (
        session.execute(
            select(PracticeSession).where(PracticeSession.session_id == str(session_id))
        )
        .scalars()
        .first()
    )
    if row is None:
        raise PracticeNotFoundError("练习轮次不存在")
    return row


def _item(session: Session, practice: PracticeSession, item_id) -> PracticeItem:
    row = (
        session.execute(
            select(PracticeItem).where(
                PracticeItem.session_id == practice.session_id,
                PracticeItem.item_id == str(item_id),
            )
        )
        .scalars()
        .first()
    )
    if row is None:
        raise PracticeNotFoundError("练习题目不存在")
    return row


def _session_payload(db: Session, practice: PracticeSession) -> dict:
    items = (
        db.execute(
            select(PracticeItem)
            .where(PracticeItem.session_id == practice.session_id)
            .order_by(PracticeItem.position)
        )
        .scalars()
        .all()
    )
    revisions = content_revision_map(db, "card", [item.card_id for item in items])
    events = {
        row.id: row
        for row in db.execute(
            select(ReviewEvent).where(
                ReviewEvent.id.in_(
                    [item.first_event_id for item in items if item.first_event_id]
                )
            )
        ).scalars()
    }
    results = []
    out_items = []
    for item in items:
        current = revisions.get(item.card_id)
        stale = (
            current is None
            or current["identity"] != item.card_identity
            or current["version"] != item.card_revision
        )
        event = events.get(item.first_event_id) if item.first_event_id else None
        processed = item.first_event_id is not None and event is not None
        event_assistance = list(event.assistance or []) if event is not None else []
        correct = event.correct if event is not None else None
        skipped = event.skipped if event is not None else False
        results.append(
            {
                "processed": processed,
                "correct": correct,
                "assistance": event_assistance,
                "skipped": skipped,
            }
        )
        if not processed:
            status = "stale" if stale else "pending"
        elif skipped:
            status = "skipped"
        elif correct is True and not event_assistance:
            status = "passed"
        else:
            status = "weak"
        hint = None
        if item.assistance:
            card = db.get(Card, item.card_id)
            if card is not None and "first_letter" in item.assistance:
                hint = {"kind": "first_letter", "value": card.word[:1]}
        payload_item = {
            "id": item.item_id,
            "card_id": item.card_id,
            "position": item.position,
            "revision": {
                "identity": item.card_identity,
                "version": item.card_revision,
            },
            "prompt": item.prompt,
            "kind": item.kind,
            "assistance": list(item.assistance or []),
            "status": status,
            "stale": stale,
            "correct": correct if processed else None,
            "skipped": skipped if processed else False,
            "hint": hint,
        }
        if item.retention_basis:
            payload_item.update(item.retention_result or item.retention_basis)
        if processed:
            # 未作答的题目不返回答案；已处理题目的答案只用于反馈。
            payload_item["expected"] = (
                (event.response or {}).get("expected") if event is not None else None
            )
        out_items.append(payload_item)
    check_status = lesson_check_status(results)
    counts = {
        "total": len(out_items),
        "processed": sum(
            1
            for item in out_items
            if item["status"] != "pending" and item["status"] != "stale"
        ),
        "passed": sum(1 for item in out_items if item["status"] == "passed"),
        "weak": sum(1 for item in out_items if item["status"] == "weak"),
        "skipped": sum(1 for item in out_items if item["status"] == "skipped"),
        "pending": sum(1 for item in out_items if item["status"] == "pending"),
        "stale": sum(1 for item in out_items if item["status"] == "stale"),
    }
    return {
        "id": practice.session_id,
        "purpose": practice.purpose,
        "lesson_id": practice.lesson_id,
        "status": check_status,
        "lifecycle": practice.status,
        "rule_version": practice.rule_version,
        "window": practice.window,
        "message": (
            "暂无符合窗口的词；旧记录不足时可先做普通练习建立依据"
            if practice.purpose == "delayed_check"
            else "本课没有可测试的词"
        )
        if not out_items
        else None,
        "items": out_items,
        "counts": counts,
    }


def create_session(
    db: Session,
    session_id,
    purpose: str,
    lesson_id: int | None,
    weak_only: bool,
    runtime: Runtime,
    window: str | None = None,
    pending_contact_ids: list[str] | None = None,
) -> dict:
    if purpose not in PURPOSES:
        raise PracticeUnavailableError("未知练习用途")
    pending_contact_ids = sorted(set(pending_contact_ids or []))
    public_id = str(session_id)
    existing = (
        db.execute(
            select(PracticeSession).where(PracticeSession.session_id == public_id)
        )
        .scalars()
        .first()
    )
    if existing is not None:
        if (
            existing.purpose != purpose
            or existing.lesson_id != lesson_id
            or existing.window != window
            or existing.pending_contact_ids != pending_contact_ids
        ):
            raise PracticeConflictError("该轮次标识已用于其他课程或用途")
        return _session_payload(db, existing)

    def operation(session: Session) -> dict:
        replay = (
            session.execute(
                select(PracticeSession).where(PracticeSession.session_id == public_id)
            )
            .scalars()
            .first()
        )
        if replay is not None:
            if (
                replay.purpose != purpose
                or replay.lesson_id != lesson_id
                or replay.window != window
                or replay.pending_contact_ids != pending_contact_ids
            ):
                raise PracticeConflictError("该轮次标识已用于其他课程或用途")
            return _session_payload(session, replay)
        issued_at = runtime.clock.now().astimezone(UTC)
        now = issued_at.replace(tzinfo=None)
        specs = (
            PURPOSES[purpose](
                session, window, pending_contact_ids, runtime, issued_at=issued_at
            )
            if purpose == "delayed_check"
            else PURPOSES[purpose](session, lesson_id, weak_only, runtime)
        )
        practice = PracticeSession(
            session_id=public_id,
            purpose=purpose,
            lesson_id=lesson_id,
            status="active" if specs else "unavailable",
            rule_version="el09-v1" if purpose == "delayed_check" else RULE_VERSION,
            window=window,
            pending_contact_ids=pending_contact_ids,
            created_at=now,
        )
        session.add(practice)
        session.flush()
        for spec in specs:
            session.add(
                PracticeItem(
                    session_id=public_id,
                    created_at=now,
                    assistance=[],
                    **spec,
                )
            )
        session.flush()
        return _session_payload(session, practice)

    return run_write(db, operation)


def get_session(db: Session, session_id) -> dict:
    return _session_payload(db, _session_by_public(db, session_id))


def active_delayed_sessions(db: Session, window: str) -> list[dict]:
    rows = db.scalars(
        select(PracticeSession)
        .where(
            PracticeSession.purpose == "delayed_check",
            PracticeSession.window == window,
            PracticeSession.status == "active",
        )
        .order_by(PracticeSession.created_at.desc(), PracticeSession.id.desc())
        .limit(1)
    )
    return [
        {"id": row.session_id, "purpose": row.purpose, "window": row.window}
        for row in rows
    ]


def set_assistance(
    db: Session, session_id, item_id, kind: str, runtime: Runtime
) -> dict:
    def operation(session: Session) -> dict:
        practice = _session_by_public(session, session_id)
        item = _item(session, practice, item_id)
        try:
            current = get_content_revision(session, "card", item.card_id)
        except LookupError:
            raise PracticeNotFoundError("目标词卡不存在或已删除")
        if (
            current["identity"] != item.card_identity
            or current["version"] != item.card_revision
        ):
            raise PracticeStaleError("内容已修订，请新开一轮")
        try:
            item.assistance = merge_assistance(item.assistance or [], [kind])
        except ValueError:
            raise PracticeUnavailableError("未知提示类型")
        session.flush()
        return _session_payload(session, practice)

    return run_write(db, operation)


def refresh_practice_session(
    session: Session, practice: PracticeSession, now: datetime
) -> None:
    """按当前题目结果统一刷新轮次生命周期与课程派生计数。"""
    items = (
        session.execute(
            select(PracticeItem)
            .where(PracticeItem.session_id == practice.session_id)
            .order_by(PracticeItem.position)
        )
        .scalars()
        .all()
    )
    if not items:
        practice.status = "unavailable"
        practice.completed_at = None
        # 轮次最后一道题被删除后，课程不能继续显示已被删除题目支撑的通过状态。
        if practice.lesson_id is not None:
            record_lesson_check(session, practice.lesson_id, 0, 0, now)
        session.flush()
        return
    events = {
        event.id: event
        for event in session.execute(
            select(ReviewEvent).where(
                ReviewEvent.id.in_(
                    [item.first_event_id for item in items if item.first_event_id]
                )
            )
        ).scalars()
    }
    results = []
    passed = 0
    complete = True
    for item in items:
        event = events.get(item.first_event_id) if item.first_event_id else None
        processed = item.first_event_id is not None and event is not None
        if not processed:
            complete = False
        correct = event.correct if event is not None else None
        assistance = list(event.assistance or []) if event is not None else []
        skipped = event.skipped if event is not None else False
        results.append(
            {
                "processed": processed,
                "correct": correct,
                "assistance": assistance,
                "skipped": skipped,
            }
        )
        if processed and correct is True and not skipped and not assistance:
            passed += 1
    if not complete:
        practice.status = "active"
        practice.completed_at = None
    else:
        practice.status = "completed"
        practice.completed_at = practice.completed_at or now
        status = lesson_check_status(results)
        # 整轮跳过（incomplete）不把课程进度改写成待巩固或通过。
        if practice.lesson_id is not None and status in ("passed", "weak"):
            record_lesson_check(session, practice.lesson_id, len(items), passed, now)
    session.flush()


def submit_practice(
    db: Session, session_id, item_id, payload, runtime: Runtime
) -> dict:
    def operation(session: Session) -> dict:
        practice = _session_by_public(session, session_id)
        item = _item(session, practice, item_id)
        existing = session.scalar(
            select(ReviewEvent).where(
                ReviewEvent.submission_id == str(payload.submission_id)
            )
        )
        command = AttemptCommand(
            card_id=item.card_id,
            submission_id=payload.submission_id,
            source="lesson" if practice.purpose == "lesson_check" else "spelling",
            kind="typed",
            answer=None if payload.skipped else payload.answer,
            skipped=payload.skipped,
            assistance=list(
                existing.assistance if existing is not None else (item.assistance or [])
            ),
            session_id=UUID(practice.session_id),
        )
        if existing is not None:
            result = apply_attempt_in_transaction(session, command, runtime)
            return {
                "committed": True,
                "event_id": result.event_id,
                "correct": result.correct,
                "expected": result.expected,
                "skipped": payload.skipped,
                "session": _session_payload(session, practice),
            }
        if practice.status == "unavailable":
            raise PracticeUnavailableError("本轮没有可测试的词")
        card = session.get(Card, item.card_id)
        if card is None:
            raise PracticeNotFoundError("目标词卡不存在或已删除")
        try:
            current = get_content_revision(session, "card", item.card_id)
        except LookupError:
            raise PracticeNotFoundError("目标词卡不存在或已删除")
        if (
            current["identity"] != item.card_identity
            or current["version"] != item.card_revision
        ):
            raise PracticeStaleError("内容已修订，请新开一轮")
        retention_basis = (
            latest_basis(session, item.card_id, current)
            if practice.purpose == "delayed_check"
            else None
        )
        result = apply_attempt_in_transaction(session, command, runtime)
        if item.first_event_id is None:
            if practice.purpose == "delayed_check":
                accepted = session.get(ReviewEvent, result.event_id)
                assert accepted is not None
                item.retention_result = classify_result(
                    retention_basis,
                    accepted.occurred_at,
                    practice.pending_contact_ids + payload.pending_contact_ids,
                )
            item.first_event_id = result.event_id
        now = runtime.clock.now().astimezone(UTC).replace(tzinfo=None)
        refresh_practice_session(session, practice, now)
        return {
            "committed": True,
            "event_id": result.event_id,
            "correct": result.correct,
            "expected": result.expected,
            "skipped": payload.skipped,
            "session": _session_payload(session, practice),
        }

    result = run_write(db, operation)
    start_pending_upgrade(db)
    return result


__all__ = [
    "MAX_ITEMS",
    "PURPOSES",
    "RULE_VERSION",
    "PracticeConflictError",
    "PracticeLessonNotFoundError",
    "PracticeNotFoundError",
    "PracticeStaleError",
    "PracticeUnavailableError",
    "create_session",
    "get_session",
    "lesson_check_status",
    "refresh_practice_session",
    "register_purpose",
    "set_assistance",
    "submit_practice",
]
