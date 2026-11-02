"""从当前修订的真实首答产生只读、可执行的学习建议。"""

from sqlalchemy import literal_column, select
from sqlalchemy.orm import Session

from app.models.card import Card
from app.models.lesson import Lesson
from app.models.review_event import ReviewEvent
from app.runtime import Runtime
from app.services.content_revisions import get_content_revision, lesson_word_cards
from app.services.learning_evidence import independent_recall_samples
from app.services.retention import delayed_items

PRIORITY = {"failed": 0, "assisted_only": 1, "delayed": 2}
REASONS = {
    "failed": "最近独立首答未答对，建议无提示提取",
    "assisted_only": "已有辅助成功，尚无独立正确首答，建议尝试无提示",
    "delayed": "应用内记录间隔符合回测窗口，建议无提示回测",
}


def choose_advice(candidates: list[dict]) -> list[dict]:
    """按理由/窗口分组，每词只进入最高优先级，最多三组各三词。"""
    seen = set()
    groups = {}
    for row in sorted(candidates, key=lambda row: PRIORITY[row["reason_kind"]]):
        if row["word_key"] in seen:
            continue
        seen.add(row["word_key"])
        key = (row["reason_kind"], row.get("window"))
        if key not in groups and len(groups) < 3:
            groups[key] = []
        if key in groups and len(groups[key]) < 3:
            groups[key].append(row)
    suggestions = []
    for (kind, window), rows in groups.items():
        count = sum(row["sample_count"] for row in rows)
        suggestions.append(
            {
                "id": f"{kind}:{window or 'recall'}",
                "purpose": "delayed_check" if window else "targeted",
                "kind": "typed",
                "reason_kind": kind,
                "reason": REASONS[kind]
                + ("；样本较少，依据有限" if count < 10 else ""),
                "card_ids": [row["card_id"] for row in rows],
                "prompts_cn": [row["prompt"] for row in rows],
                "targets": [
                    {"card_id": row["card_id"], "revision": row["revision"]}
                    for row in rows
                ],
                "window": window,
                "sample_count": count,
                "event_ids": [
                    identity for row in rows for identity in row["event_ids"]
                ],
            }
        )
    return suggestions


def recommendations(
    db: Session, runtime: Runtime, *, delayed_enabled: bool = True
) -> dict:
    candidates = []
    cards = list(db.scalars(select(Card).where(Card.kind == "word").order_by(Card.id)))
    samples_by_card = {}
    basis_events_by_card = {}
    word_keys = {card.id: card.word.strip().casefold() for card in cards}
    for card in cards:
        if not (card.meaning or "").strip():
            continue
        revision = get_content_revision(db, "card", card.id)
        events = list(
            db.scalars(
                select(ReviewEvent)
                .where(ReviewEvent.card_id == card.id)
                .order_by(
                    ReviewEvent.occurred_at, literal_column("review_events.rowid")
                )
            )
        )
        samples = independent_recall_samples(events, revision)
        samples_by_card[card.id] = samples
        # 回测的接触依据可以来自自评/辅助；这些事件不进入独立样本分母。
        basis_events_by_card[card.id] = [
            event.id
            for event in events
            if event.card_identity == revision["identity"]
            and event.card_revision == revision["version"]
            and not event.skipped
        ][-1:]
        assisted = [
            event
            for event in events
            if event.kind == "typed"
            and event.source != "legacy"
            and event.card_identity == revision["identity"]
            and event.card_revision == revision["version"]
            and event.correct is True
            and event.assistance
            and not event.skipped
        ]
        kind = None
        evidence = []
        if samples and samples[-1].correct is False:
            kind, evidence = "failed", [samples[-1].id]
        elif assisted and not any(event.correct is True for event in samples):
            kind, evidence = "assisted_only", [assisted[-1].id]
        if kind:
            candidates.append(
                {
                    "card_id": card.id,
                    "word_key": word_keys[card.id],
                    "revision": revision,
                    "prompt": card.meaning,
                    "reason_kind": kind,
                    "sample_count": len(samples),
                    "event_ids": evidence,
                }
            )
    if delayed_enabled:
        primary_words = {row["word_key"] for row in candidates}
        delayed_targets = [
            card.id for card in cards if word_keys[card.id] not in primary_words
        ]
        for window in ("day", "week"):
            for item in delayed_items(
                db, window, [], runtime, target_ids=delayed_targets
            ):
                candidates.append(
                    {
                        "card_id": item["card_id"],
                        "word_key": word_keys[item["card_id"]],
                        "revision": {
                            "identity": item["card_identity"],
                            "version": item["card_revision"],
                        },
                        "prompt": item["prompt"],
                        "reason_kind": "delayed",
                        "window": window,
                        "sample_count": len(samples_by_card[item["card_id"]]),
                        "event_ids": list(
                            dict.fromkeys(
                                [event.id for event in samples_by_card[item["card_id"]]]
                                + basis_events_by_card[item["card_id"]]
                            )
                        ),
                    }
                )
    suggestions = choose_advice(candidates)
    lesson_labels = {}
    for lesson in db.scalars(select(Lesson).order_by(Lesson.level)):
        for word in lesson_word_cards(db, lesson):
            lesson_labels.setdefault(word["id"], []).append(f"第 {lesson.level} 课")
    for suggestion in suggestions:
        suggestion["lesson_labels"] = list(
            dict.fromkeys(
                label
                for card_id in suggestion["card_ids"]
                for label in lesson_labels.get(card_id, [])
            )
        )
    return {
        "enabled": True,
        "suggestions": suggestions,
        "message": "可先积累少量独立练习；暂无数据不代表能力不足"
        if not suggestions
        else None,
    }
