"""学习活动统计：从不可变学习事件读取，不覆盖、不补造。

事件在写入时已固定 learning_day 与 learning_timezone；历史读取只按存储值
聚合，后续修改时区不会重写过去日期。迁移基线不是事件，不进入日历。
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

EventDict = dict[str, Any]


def learning_day(when: datetime, tz: str) -> str:
    """把带时区的时间归属到指定 IANA 时区的学习日。"""
    if when.tzinfo is None:
        raise ValueError("event time must be timezone-aware")
    return when.astimezone(ZoneInfo(tz)).date().isoformat()


def _active_days(events: list[EventDict]) -> set[str]:
    return {event["learning_day"] for event in events if not event["skipped"]}


def summary_for_day(events: list[EventDict], today: str) -> dict[str, int]:
    """当天完成词数（按卡去重）、练习次数、跳过数，以及连续学习天数。"""
    todays = [event for event in events if event["learning_day"] == today]
    return {
        "reviewed_today": len(
            {event["card_id"] for event in todays if event["scheduled"]}
        ),
        "attempted_today": sum(1 for event in todays if not event["skipped"]),
        "skipped_today": sum(1 for event in todays if event["skipped"]),
        "streak": _streak(events, today),
    }


def _streak(events: list[EventDict], today: str) -> int:
    active = _active_days(events)
    cursor = datetime.fromisoformat(today).date()
    if cursor.isoformat() not in active:
        cursor -= timedelta(days=1)
    streak = 0
    while cursor.isoformat() in active:
        streak += 1
        cursor -= timedelta(days=1)
    return streak


def _first_scheduled_day(events: list[EventDict]) -> dict[int, str]:
    """每张卡第一条真实排期事件所在的学习日；迁移基线不参与。"""
    first: dict[int, tuple[datetime, str, str]] = {}
    for event in events:
        if not event["scheduled"]:
            continue
        key = (
            event["occurred_at"],
            event["event_id"],
            event["learning_day"],
        )
        card_id = event["card_id"]
        if card_id not in first or key[:2] < first[card_id][:2]:
            first[card_id] = key
    return {card_id: value[2] for card_id, value in first.items()}


def _objective_rows(events: list[EventDict], predicate) -> list[EventDict]:
    return [
        event
        for event in events
        if event["source"] != "legacy"
        and not event["skipped"]
        and predicate(event)
        and event["correct"] is not None
    ]


def _metric(successes: int, count: int) -> dict[str, int | None]:
    return {
        "successes": successes,
        "count": count,
        "percent": round(successes / count * 100) if count else None,
    }


def metric(events: list[EventDict], category: str) -> dict[str, int | None]:
    """按题型分类的可靠指标；无有效样本返回 percent=None。"""
    if category == "self_report":
        rows = [
            event
            for event in events
            if event["source"] != "legacy"
            and not event["skipped"]
            and event["kind"] == "self_rating"
            and (event["self_rating"] is not None or event["fsrs_rating"] is not None)
        ]
        successes = sum(
            1
            for event in rows
            if (
                event["self_rating"]
                if event["self_rating"] is not None
                else event["fsrs_rating"]
            )
            >= 3
        )
        return _metric(successes, len(rows))
    if category == "retrieval":
        rows = _objective_rows(
            events,
            lambda event: event["kind"] == "typed" and not event["assistance"],
        )
    elif category == "assisted":
        rows = _objective_rows(
            events,
            lambda event: event["kind"] == "typed" and bool(event["assistance"]),
        )
    elif category == "recognition":
        rows = _objective_rows(
            events, lambda event: event["kind"] in ("choice", "related")
        )
    else:
        raise ValueError(f"unknown metric category: {category}")
    return _metric(sum(1 for event in rows if event["correct"] is True), len(rows))


def review_pass_rate(events: list[EventDict]) -> dict[str, int | None]:
    """可排期事件的复习通过率：1–2 分需强化，3–4 分通过。"""
    rows = [
        event
        for event in events
        if event["source"] != "legacy"
        and not event["skipped"]
        and event["scheduled"]
        and event["fsrs_rating"] is not None
    ]
    return _metric(
        sum(1 for event in rows if event["fsrs_rating"] >= 3),
        len(rows),
    )


def adaptive_new_limit(
    events: list[EventDict], today: str, base: int = 10
) -> tuple[int, float | None, int]:
    """近 7 个学习日、同卡同日首条可排期事件决定新词建议。

    样本不足 20 不自动上调；错误率 >30% 仍可下调到 5。无样本时沿用 base。
    """
    start = (datetime.fromisoformat(today).date() - timedelta(days=6)).isoformat()
    first: dict[tuple[int, str], EventDict] = {}
    for event in sorted(
        events, key=lambda item: (item["occurred_at"], item["event_id"])
    ):
        eligible_kind = event["kind"] == "self_rating" or (
            event["kind"] == "typed" and not event["assistance"]
        )
        if (
            not event["scheduled"]
            or event["source"] == "legacy"
            or not eligible_kind
            or event["fsrs_rating"] is None
            or not start <= event["learning_day"] <= today
        ):
            continue
        first.setdefault((event["card_id"], event["learning_day"]), event)

    sample = list(first.values())
    if not sample:
        return base, None, 0
    error = sum(event["fsrs_rating"] <= 2 for event in sample) / len(sample)
    if error > 0.30:
        limit = 5
    elif len(sample) >= 20 and error < 0.15:
        limit = 15
    else:
        limit = 10
    return limit, error, len(sample)


def history_days(
    events: list[EventDict], start: str, end: str
) -> list[dict[str, int | str]]:
    """按学习日返回 [start, end] 的每日聚合，缺失日期零填充。"""
    first_days = _first_scheduled_day(events)
    counts: dict[str, dict[str, int | set[int]]] = {}
    for event in events:
        day = event["learning_day"]
        if day < start or day > end:
            continue
        row = counts.setdefault(
            day, {"reviews": 0, "reviewed_words": set(), "skipped": 0, "new_cards": 0}
        )
        if event["skipped"]:
            row["skipped"] += 1
            continue
        row["reviews"] += 1
        if event["scheduled"]:
            row["reviewed_words"].add(event["card_id"])
    for day in first_days.values():
        if start <= day <= end:
            counts.setdefault(
                day, {"reviews": 0, "reviewed_words": set(), "skipped": 0, "new_cards": 0}
            )["new_cards"] += 1

    result: list[dict[str, int | str]] = []
    cursor = datetime.fromisoformat(start).date()
    last = datetime.fromisoformat(end).date()
    while cursor <= last:
        day = cursor.isoformat()
        row = counts.get(day)
        result.append(
            {
                "date": day,
                "reviews": int(row["reviews"]) if row else 0,
                "reviewed_words": len(row["reviewed_words"]) if row else 0,
                "skipped": int(row["skipped"]) if row else 0,
                "new_cards": int(row["new_cards"]) if row else 0,
            }
        )
        cursor += timedelta(days=1)
    return result
