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
