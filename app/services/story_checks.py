"""Frozen story checks reuse practice contexts and the unified learning writer."""

from uuid import uuid4

from sqlalchemy import select

from app.models.card import Card
from app.models.story import StoryWord
from app.models.story_version import StoryVersion
from app.services.content_revisions import get_content_revision
from app.services.story_quality import validate_story


def story_check_kinds(has_choice: bool, has_target: bool) -> list[str]:
    return (["reading_choice"] if has_choice else []) + (
        ["typed"] if has_target else []
    )


def story_version(db, version_id):
    return db.scalar(select(StoryVersion).where(StoryVersion.version_id == version_id))


def version_is_current(db, version):
    if version is None or version.story_id is None:
        return False
    try:
        current = get_content_revision(db, "story", version.story_id)
    except LookupError:
        return False
    return current == {
        "identity": version.story_identity,
        "version": version.story_revision,
    }


def check_items(db, story_id, version_id):
    from app.services.practice import PracticeNotFoundError, PracticeStaleError

    version = story_version(db, version_id)
    if version is None or version.story_id is None:
        raise PracticeNotFoundError("故事或版本已删除，请返回故事")
    if version.story_id != story_id or not version_is_current(db, version):
        raise PracticeStaleError("故事版本已变化，请返回原文")
    material = version.material
    quality = version.quality
    check = material.get("check")
    # Missing/invalid question never triggers a new model call or invented options.
    valid_choice = bool(check) and not validate_story(
        material,
        set(quality.get("known_words", [])),
        set(quality.get("support_words", [])),
        "normal",
    )
    if valid_choice:
        valid_choice = (
            quality.get("known_basis") == "verified"
            and check.get("evidence_sentence")
            == material["sentences"][check["evidence_index"]]["en"]
        )
    cards = list(
        db.scalars(
            select(Card)
            .join(StoryWord, Card.id == StoryWord.card_id)
            .where(
                StoryWord.story_id == story_id,
                Card.kind == "word",
            )
            .order_by(Card.id)
        )
    )
    cards = [c for c in cards if c.word.lower() in material.get("targets", [])]
    if not cards:
        return []
    typed = next((c for c in cards if (c.meaning or "").strip()), None)
    result = []
    for position, kind in enumerate(
        story_check_kinds(valid_choice, typed is not None), 1
    ):
        card = cards[0] if kind == "reading_choice" else typed
        assert card is not None
        revision = get_content_revision(db, "card", card.id)
        result.append(
            {
                "item_id": str(uuid4()),
                "card_id": card.id,
                "card_identity": revision["identity"],
                "card_revision": revision["version"],
                "position": position,
                "kind": kind,
                "prompt": check["question"]
                if kind == "reading_choice"
                else card.meaning,
                "question": check if kind == "reading_choice" else None,
            }
        )
    return result


def reading_counts(items):
    counts = {"recognition_count": 0, "independent_count": 0, "assisted_count": 0}
    for item in items:
        if item["status"] in ("pending", "stale", "skipped"):
            continue
        key = (
            "recognition_count"
            if item["kind"] == "reading_choice"
            else ("assisted_count" if item["assistance"] else "independent_count")
        )
        counts[key] += 1
    return counts


def reading_overview(db):
    from app.models.practice import PracticeItem, PracticeSession
    from app.models.review_event import ReviewEvent

    rows = db.execute(
        select(PracticeItem.kind, ReviewEvent)
        .join(
            PracticeSession,
            PracticeSession.session_id == PracticeItem.session_id,
        )
        .join(ReviewEvent, ReviewEvent.id == PracticeItem.first_event_id)
        .where(
            PracticeSession.purpose == "story_check",
        )
    )
    return reading_counts(
        [
            {
                "kind": kind,
                "status": "skipped" if event.skipped else "processed",
                "assistance": event.assistance or [],
            }
            for kind, event in rows
        ]
    )
