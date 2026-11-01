"""应用内接触：服务端确认时间、目标修订与幂等保存。

接触只说明“学习者在本应用实际看到或听到过该内容”，不是作答或完成量。
客户端只在展示或播放真实发生后上报；服务端只接受已确认时间，不信任客户端
回填的时间。
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import get_args

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.card import Card
from app.models.learning_contact import LearningContact
from app.runtime import Runtime
from app.schemas.learning import Assistance, ContactCommand
from app.services.content_revisions import get_content_revision
from app.services.write_transaction import run_write

ASSISTANCE_VALUES = frozenset(get_args(Assistance))


class ContactTargetNotFoundError(LookupError):
    """目标词卡不存在或已删除。"""


class ContactRevisionConflictError(RuntimeError):
    """展示时的内容修订已不是当前修订。"""


class ContactSubmissionConflictError(RuntimeError):
    """同一提交标识已用于不同的接触内容。"""


def contact_time(
    confirmed_at: str, client_at: str | None, displayed: bool, prefetch: bool
) -> str | None:
    """接触时间的唯一规则：未展示或仅预取不算接触，其余只取服务端时间。"""
    if not displayed or prefetch:
        return None
    return confirmed_at


def merge_assistance(previous: list[str], added: list[str]) -> list[str]:
    """提示只增不减；同一题一旦辅助，后续提交必须保留。"""
    values = set(previous) | set(added)
    if not values <= ASSISTANCE_VALUES:
        raise ValueError("unknown assistance")
    return sorted(values)


def visible_card_ids(text: str, cards: list[dict]) -> list[int]:
    """文本中按完整词边界出现的目标卡；子串、大小写变化与重复不改变身份。"""
    found = set()
    for card in cards:
        word = card.get("word", "").strip()
        if word and re.search(
            r"(?<![A-Za-z])" + re.escape(word) + r"(?![A-Za-z])",
            text,
            re.IGNORECASE,
        ):
            found.add(card["id"])
    return sorted(found)


def _iso(value: datetime) -> str:
    return value.replace(tzinfo=UTC).isoformat()


def _payload(row: LearningContact) -> dict:
    return {
        "occurred_at": _iso(row.occurred_at),
        "source": row.source,
        "kind": row.kind,
        "card_identity": row.card_identity,
        "card_revision": row.card_revision,
    }


def _matches_submission(row: LearningContact, payload: ContactCommand) -> bool:
    return (
        row.card_id == payload.card_id
        and row.source == payload.source
        and row.kind == payload.kind
        and row.card_identity == str(payload.revision.identity)
        and row.card_revision == payload.revision.version
    )


def contact_summary(db: Session, card_id: int) -> tuple[dict | None, dict]:
    """最近一次已确认接触；没有记录时保持未知，不宣称从未接触。"""
    row = (
        db.execute(
            select(LearningContact)
            .where(LearningContact.card_id == card_id)
            .order_by(
                LearningContact.occurred_at.desc(), LearningContact.id.desc()
            )
            .limit(1)
        )
        .scalars()
        .first()
    )
    if row is None:
        return None, {
            "status": "unknown",
            "basis": "missing_history",
            "label": "旧数据未记录，接触依据未知",
        }
    return _payload(row), {
        "status": "confirmed",
        "basis": "server_confirmed",
        "label": "服务端确认时间",
    }


def record_contact(db: Session, payload: ContactCommand, runtime: Runtime) -> dict:
    """确认一次实际展示或播放；同内容回放优先于修订失效检查。"""

    def operation(session: Session) -> dict:
        submission_id = str(payload.submission_id)
        existing = (
            session.execute(
                select(LearningContact).where(
                    LearningContact.submission_id == submission_id
                )
            )
            .scalars()
            .first()
        )
        if existing is not None:
            if not _matches_submission(existing, payload):
                raise ContactSubmissionConflictError("该提交标识已用于不同的接触记录")
            return {
                "committed": True,
                "contact_id": existing.id,
                "occurred_at": _iso(existing.occurred_at),
            }
        card = session.get(Card, payload.card_id)
        if card is None:
            raise ContactTargetNotFoundError("目标词卡不存在或已删除")
        revision = get_content_revision(session, "card", card.id)
        if (
            str(payload.revision.identity) != revision["identity"]
            or payload.revision.version != revision["version"]
        ):
            raise ContactRevisionConflictError("内容已修订，请重新查看后确认接触")
        now = runtime.clock.now().astimezone(UTC)
        confirmed_at = contact_time(now.isoformat(), None, True, False)
        assert confirmed_at is not None  # 路由只处理已展示、非预取的确认
        row = LearningContact(
            submission_id=submission_id,
            card_id=card.id,
            card_identity=revision["identity"],
            card_revision=revision["version"],
            source=payload.source,
            kind=payload.kind,
            occurred_at=datetime.fromisoformat(confirmed_at).replace(tzinfo=None),
        )
        session.add(row)
        session.flush()
        return {
            "committed": True,
            "contact_id": row.id,
            "occurred_at": _iso(row.occurred_at),
        }

    return run_write(db, operation)


__all__ = [
    "ASSISTANCE_VALUES",
    "ContactRevisionConflictError",
    "ContactSubmissionConflictError",
    "ContactTargetNotFoundError",
    "contact_summary",
    "contact_time",
    "merge_assistance",
    "record_contact",
    "visible_card_ids",
]
