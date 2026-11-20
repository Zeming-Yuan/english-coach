"""Confirm a displayed expansion once, preserving the existing word card."""

from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models.card import Card
from app.models.expansion_addition import ExpansionAddition
from app.schemas.expansion_additions import ExpansionAdditionIn
from app.services.content_revisions import get_content_revision
from app.services.word_expansions import normalize_expansions
from app.services.write_transaction import run_write


def confirmed_addition(db: Session, operation_id: str) -> ExpansionAddition | None:
    return db.scalar(
        select(ExpansionAddition).where(ExpansionAddition.operation_id == operation_id)
    )


def addition_reference(addition: ExpansionAddition) -> dict:
    return {
        "operation_id": addition.operation_id,
        "source_card_id": addition.source_card_id,
        "target_card_id": addition.target_card_id,
        "available": addition.target_card_id is not None,
    }


def additions_for_target(db: Session, target_card_id: int) -> list[dict]:
    rows = db.scalars(
        select(ExpansionAddition)
        .where(ExpansionAddition.target_card_id == target_card_id)
        .order_by(ExpansionAddition.id.desc())
    )
    return [addition_reference(row) for row in rows]


def detach_expansion_additions(db: Session, card_id: int) -> None:
    # SQLite connections also support the application's explicit deletion topology.
    for column in (ExpansionAddition.source_card_id, ExpansionAddition.target_card_id):
        db.execute(
            update(ExpansionAddition).where(column == card_id).values({column: None})
        )


def _response(addition: ExpansionAddition) -> dict:
    return {
        "committed": True,
        "operation_id": addition.operation_id,
        "card_id": addition.target_card_id,
        "created": addition.created,
        "available": addition.target_card_id is not None,
    }


def confirm_expansion(
    db: Session,
    source_id: int,
    command: ExpansionAdditionIn,
    now: datetime,
    *,
    enabled: bool,
) -> dict:
    revision = command.source_revision.model_dump(mode="json")
    word = command.target.word.casefold()
    meaning = command.target.meaning
    operation_id = str(command.operation_id)

    def operation(session: Session) -> dict:
        replay = confirmed_addition(session, operation_id)
        if replay is not None:
            if (
                replay.original_source_id != source_id
                or replay.source_identity != revision["identity"]
                or replay.source_version != revision["version"]
                or replay.target_word != word
                or replay.target_meaning != meaning
            ):
                raise HTTPException(409, "该加入请求号已用于其他词条")
            return _response(replay)
        if not enabled:
            raise HTTPException(403, "新加入暂时关闭，已保存词卡仍可读取")

        source = session.get(Card, source_id)
        if source is None:
            raise HTTPException(404, "来源词卡已删除或恢复，请重新查看扩展词")
        current = get_content_revision(session, "card", source_id)
        if current != revision:
            raise HTTPException(409, "来源词卡已更新，请重新查看扩展词")
        candidates = (
            row
            for entry in source.related_words or []
            for row in normalize_expansions([entry], word=source.word)
            if row.get("word", "").casefold() == word and row.get("meaning") == meaning
        )
        selected = next(candidates, None) if source.kind == "word" else None
        if selected is None:
            raise HTTPException(409, "扩展词已变化，请重新查看后加入")

        target = next(
            (
                card
                for card in session.scalars(
                    select(Card).where(Card.kind == "word").order_by(Card.id)
                )
                if card.word.strip().casefold() == word
            ),
            None,
        )
        created = target is None
        if target is None:
            target = Card(
                word=selected["word"],
                meaning=selected["meaning"],
                kind="word",
                difficulty="basic",
            )
            session.add(target)
            session.flush()
        target_revision = get_content_revision(session, "card", target.id)
        addition = ExpansionAddition(
            operation_id=operation_id,
            source_card_id=source_id,
            target_card_id=target.id,
            original_source_id=source_id,
            source_identity=current["identity"],
            source_version=current["version"],
            target_identity=target_revision["identity"],
            target_word=word,
            target_meaning=meaning,
            created=created,
            created_at=now.astimezone(UTC).replace(tzinfo=None),
        )
        session.add(addition)
        return _response(addition)

    return run_write(db, operation)
