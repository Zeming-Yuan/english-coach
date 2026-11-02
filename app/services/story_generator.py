"""Bounded stories: evidence selection, external generation, atomic publication."""

import json
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.card import Card
from app.models.story import Story, StoryWord
from app.models.story_version import StoryVersion
from app.runtime import Runtime
from app.services.content_revisions import get_content_revision
from app.services.learning_evidence import bulk_evidence_summaries
from app.services.llm import generate_json
from app.services.story_quality import SUPPORT, starter_payload
from app.services.write_transaction import run_write

SYSTEM_PROMPT = (
    "编写适合初学者的英文故事。正文40–70词，每句最多12词（标题、题干和选项也一样）。"
    "仅用提供的known_words和support_words词形，额外未知词形最多2个，不做词形还原。"
    "必须在正文使用全部targets；只允许new_targets所列的新目标。逐句自然中英配对。"
    "提供三选一理解题，答案须是证据句中的一个词，其他选项不得出现在证据句。"
    '严格JSON: {"title":"...","title_cn":"...","targets":["..."],'
    '"sentences":[{"en":"...","cn":"..."}],'
    '"check":{"question":"...","question_cn":"...","options":["...","...","..."],'
    '"options_cn":["...","...","..."],"expected":"...","evidence_index":0}}'
)


def _replay(db, operation_id, consent):
    row = db.scalar(
        select(StoryVersion).where(StoryVersion.operation_id == operation_id)
    )
    if row is None:
        return None
    if row.include_new_target != consent:
        raise HTTPException(409, "同一操作标识的生成选项不同，请新建操作")
    if row.story_id is None:
        raise HTTPException(410, "该操作的故事已删除，不会重新生成")
    revision = get_content_revision(db, "story", row.story_id)
    if revision != {"identity": row.story_identity, "version": row.story_revision}:
        raise HTTPException(409, "故事已修订，请读取当前内容")
    return db.get(Story, row.story_id)


def generate_story(
    db: Session, runtime: Runtime, operation_id: str, include_new_target: bool = False
):
    replay = _replay(db, operation_id, include_new_target)
    if replay is not None:
        return replay
    cards = list(db.scalars(select(Card).where(Card.kind == "word").order_by(Card.id)))
    summaries = bulk_evidence_summaries(db, [c.id for c in cards], runtime)
    known_cards = [
        c for c in cards if summaries[c.id]["recall"]["status"] == "verified"
    ]
    if not known_cards:
        return starter_payload()
    # Exact single word forms only; phrases are not individual vocabulary targets.
    from app.services.story_quality import tokens

    known_cards = [c for c in known_cards if tokens(c.word) == [c.word.lower()]]
    if not known_cards:
        return starter_payload()
    # Multiple legacy cards for one word do not create multiple target forms.
    unique_known = {}
    for card in known_cards:
        unique_known.setdefault(card.word.lower(), card)
    known_cards = list(unique_known.values())
    selected = known_cards[:3]
    known_basis_ids = [c.id for c in known_cards]
    known_targets = [c.word.lower() for c in selected]
    known = {c.word.lower() for c in known_cards}
    new_cards = [
        c
        for c in cards
        if c.word.lower() not in known and tokens(c.word) == [c.word.lower()]
    ]
    new_target = new_cards[:1] if include_new_target else []
    selected += new_target
    targets = [c.word.lower() for c in selected]
    revisions = {c.id: get_content_revision(db, "card", c.id) for c in selected}
    # Restore changes internal story IDs even when the snapshot retains identities.
    # Keep a core revision map as a generation fence without holding the write lock.
    from app.models.content_revision import ContentRevision

    fence = list(
        db.execute(
            select(
                ContentRevision.id, ContentRevision.identity, ContentRevision.version
            ).order_by(ContentRevision.id)
        )
    )
    payload = {
        "known_words": sorted(known),
        "support_words": SUPPORT["words"],
        "support_version": SUPPORT["version"],
        "targets": targets,
        "new_targets": [c.word.lower() for c in new_target],
    }
    db.rollback()  # External call holds neither a SQLite read snapshot nor a write lock.
    from app.services.story_quality import validate_story

    data = None
    errors = []
    for _ in range(2):
        data = generate_json(
            SYSTEM_PROMPT,
            json.dumps(
                {**payload, "validation_errors": errors, "previous_material": data},
                ensure_ascii=False,
            ),
        )
        if data is None:
            raise HTTPException(502, "故事生成失败，已有内容保留；可重试或阅读入门材料")
        errors = validate_story(data, known, set(SUPPORT["words"]), "normal")
        if data.get("targets") != targets:
            errors.append("selected_targets")
        if not errors:
            break
    if errors:
        raise HTTPException(422, "两次生成仍不合格，已有内容保留：" + ", ".join(errors))
    quality = {
        "known_basis": "verified",
        "known_targets": known_targets,
        "new_targets": payload["new_targets"],
        "known_words": sorted(known),
        "support_version": SUPPORT["version"],
        "support_words": SUPPORT["words"],
        "unknown_forms": [],
        "word_count": sum(len(tokens(r["en"])) for r in data["sentences"]),
    }
    all_text = " ".join(
        [
            data["title"],
            *[r["en"] for r in data["sentences"]],
            data["check"]["question"],
            *data["check"]["options"],
        ]
    )
    quality["unknown_forms"] = sorted(
        set(tokens(all_text)) - known - set(SUPPORT["words"])
    )
    material = {
        **data,
        "check": {
            **data["check"],
            "evidence_sentence": data["sentences"][data["check"]["evidence_index"]][
                "en"
            ],
        },
    }

    def save(session):
        replay = _replay(session, operation_id, include_new_target)
        if replay is not None:
            return replay
        current_fence = list(
            session.execute(
                select(
                    ContentRevision.id,
                    ContentRevision.identity,
                    ContentRevision.version,
                ).order_by(ContentRevision.id)
            )
        )
        if current_fence != fence:
            raise HTTPException(409, "生成期间内容已修订、删除或恢复，请重新生成")
        current = bulk_evidence_summaries(session, known_basis_ids, runtime)
        if any(s["recall"]["status"] != "verified" for s in current.values()):
            raise HTTPException(409, "生成期间回忆依据已变化，请重新生成")
        for card_id, revision in revisions.items():
            if get_content_revision(session, "card", card_id) != revision:
                raise HTTPException(409, "生成目标已变化，请重新生成")
        story = Story(
            title=data["title"],
            title_cn=data["title_cn"],
            content="\n".join(r["en"] for r in data["sentences"]),
            content_cn="\n".join(r["cn"] for r in data["sentences"]),
        )
        session.add(story)
        session.flush()
        revision = get_content_revision(session, "story", story.id)
        for card_id in revisions:
            session.add(StoryWord(story_id=story.id, card_id=card_id))
        session.add(
            StoryVersion(
                story_id=story.id,
                version_id=str(uuid4()),
                operation_id=operation_id,
                include_new_target=include_new_target,
                story_identity=revision["identity"],
                story_revision=revision["version"],
                material=material,
                quality=quality,
            )
        )
        session.flush()
        return story

    return run_write(db, save)
