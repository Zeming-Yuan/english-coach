"""旧版备份校验与原子部分恢复。

只恢复备份实际包含的卡与关联；未覆盖的课程、故事、其他卡保持原样。
旧复习转成当前状态 + 迁移基线，不伪造学习事件。写入与普通学习共用
run_write 的 BEGIN IMMEDIATE，任何失败整体回滚。
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.card import Card
from app.models.error_card import ErrorCard
from app.models.memo import Memo
from app.models.review import Review
from app.models.review_baseline import ReviewBaseline
from app.runtime import Runtime
from app.schemas.backup import (
    BackupValidationError,
    ValidatedBackup,
    validate_legacy_backup,
)
from app.services.backup import export_backup, snapshot_revision
from app.services.write_transaction import run_write


class AmbiguousTargetError(ValueError):
    """同一单词与卡型在目标库有多张卡，拒绝任意挑选。"""


class RevisionConflictError(RuntimeError):
    """预览后数据库出现新进度，需要重新预览。"""


def persist_safety_backup(payload: dict, directory: Path) -> Path:
    """原子写入恢复前完整备份；fsync 成功后才替换为最终文件。"""
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    destination = directory / f"before-restore-{uuid4()}.json"
    fd, temp = tempfile.mkstemp(dir=directory, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(payload, stream, ensure_ascii=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, destination)
        return destination
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def _match_target(session: Session, word: str, kind: str) -> Card | None:
    rows = (
        session.execute(select(Card).where(Card.word == word, Card.kind == kind))
        .scalars()
        .all()
    )
    if len(rows) > 1:
        raise AmbiguousTargetError(
            f"目标库存在多张 {kind} 类型的 “{word}” 卡片，无法确定恢复目标"
        )
    return rows[0] if rows else None


def _target_map(
    session: Session, validated: ValidatedBackup
) -> dict[int, tuple[Card | None, dict]]:
    mapping: dict[int, tuple[Card | None, dict]] = {}
    for row in validated.tables["cards"]:
        target = _match_target(session, row["word"], row.get("kind", "word"))
        mapping[row["id"]] = (target, row)
    return mapping


def _jsonable(value):
    if isinstance(value, dict):
        return {key: _jsonable(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_jsonable(item) for item in value]
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def _fingerprint(card_id: int, row: dict) -> str:
    encoded = json.dumps(
        {"card_id": card_id, "row": _jsonable(row)},
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
        default=str,
    )
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _naive(value):
    """数据库列使用 naive UTC；带时区输入统一转换。"""
    if isinstance(value, datetime) and value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def _current_review(rows: list[dict]) -> dict:
    return max(
        enumerate(rows),
        key=lambda pair: (
            pair[1].get("last_review") is not None,
            _naive(pair[1].get("last_review")) or datetime.min,
            pair[0],
        ),
    )[1]


def _baseline_exists(session: Session, fingerprint: str) -> bool:
    return (
        session.execute(
            select(ReviewBaseline.id)
            .where(ReviewBaseline.source_fingerprint == fingerprint)
            .limit(1)
        ).first()
        is not None
    )


def _apply_restore(
    session: Session,
    validated: ValidatedBackup,
    runtime: Runtime,
) -> dict:
    mapping = _target_map(session, validated)
    new_cards = 0
    for source_id, (target, row) in mapping.items():
        fields = {
            key: value
            for key, value in row.items()
            if key not in ("id", "word", "kind")
        }
        if target is None:
            card = Card(word=row["word"], kind=row.get("kind", "word"), **fields)
            session.add(card)
            session.flush()
            mapping[source_id] = (card, row)
            new_cards += 1
        else:
            for key, value in fields.items():
                setattr(target, key, value)

    now = runtime.clock.now().replace(tzinfo=None)
    grouped_reviews: dict[int, list[dict]] = {}
    for row in validated.tables["reviews"]:
        grouped_reviews.setdefault(row["card_id"], []).append(row)
    for source_id, rows in grouped_reviews.items():
        target, _ = mapping[source_id]
        if target is None:
            continue
        chosen = _current_review(rows)
        chosen_fingerprint = _fingerprint(target.id, chosen)
        if _baseline_exists(session, chosen_fingerprint):
            continue  # 同一旧备份重复导入：不重复、不覆盖新进度
        review = (
            session.execute(
                select(Review)
                .where(Review.card_id == target.id)
                .order_by(Review.id.desc())
                .limit(1)
            )
            .scalars()
            .first()
        )
        if review is None:
            review = Review(card_id=target.id)
            session.add(review)
        review.state = chosen["state"]
        review.step = chosen.get("step")
        review.due = _naive(chosen.get("due")) or now
        review.stability = chosen.get("stability") or 0.0
        review.difficulty = chosen.get("difficulty") or 0.0
        review.elapsed_days = chosen.get("elapsed_days", 0)
        review.last_review = _naive(chosen.get("last_review"))
        review.review_count = chosen.get("review_count", 1)
        review.rating = chosen.get("rating")
        for index, row in enumerate(rows):
            fingerprint = _fingerprint(target.id, row)
            if _baseline_exists(session, fingerprint):
                continue
            session.add(
                ReviewBaseline(
                    id=str(uuid4()),
                    card_id=target.id,
                    source_review_id=None,
                    source_kind="legacy_import",
                    raw=_jsonable(row),
                    selected=row is chosen,
                    captured_at=now,
                    last_activity=_naive(row.get("last_review") or row.get("due")),
                    cumulative_count=row.get("review_count", 1),
                    source_fingerprint=fingerprint,
                )
            )

    for row in validated.tables["memos"]:
        target, _ = mapping[row["card_id"]]
        if target is None:
            continue
        memo = (
            session.execute(select(Memo).where(Memo.card_id == target.id))
            .scalars()
            .first()
        )
        if memo is None:
            session.add(Memo(card_id=target.id, content=row["content"]))
        else:
            memo.content = row["content"]

    for row in validated.tables["errors"]:
        target, _ = mapping[row["card_id"]]
        if target is None:
            continue
        error = (
            session.execute(select(ErrorCard).where(ErrorCard.card_id == target.id))
            .scalars()
            .first()
        )
        if error is None:
            session.add(
                ErrorCard(card_id=target.id, error_count=row["error_count"])
            )
        else:
            error.error_count = row["error_count"]

    return {
        "imported_words": new_cards,
        "requests": len(validated.tables["cards"]),
        "mode": "legacy_partial",
    }


def preview_legacy_restore(
    db: Session, payload: dict, runtime: Runtime
) -> dict:
    """只读预览：范围、影响与当前数据库修订。"""
    validated = validate_legacy_backup(payload)
    mapping = _target_map(db, validated)
    existing = sum(1 for target, _ in mapping.values() if target is not None)
    revision = snapshot_revision(export_backup(db, runtime))
    return {
        "mode": "legacy_partial",
        "counts": {
            collection: len(rows) for collection, rows in validated.tables.items()
        },
        "impact": {
            "new_cards": len(mapping) - existing,
            "matched_cards": existing,
            "reviews": len(validated.tables["reviews"]),
            "memos": len(validated.tables["memos"]),
            "errors": len(validated.tables["errors"]),
        },
        "expected_revision": revision,
        "payload_digest": validated.payload_digest,
    }


def restore_legacy_backup(
    db: Session,
    payload: dict,
    expected_revision: str | None,
    runtime: Runtime,
    safety_directory: Path,
) -> dict:
    """校验通过后，在单一写事务内执行旧版部分恢复。"""
    validated = validate_legacy_backup(payload)

    def operation(session: Session) -> dict:
        revision = snapshot_revision(export_backup(session, runtime))
        if expected_revision is not None and revision != expected_revision:
            raise RevisionConflictError("预览后数据已有变化，请重新预览")
        safety_payload = export_backup(session, runtime)
        safety_path = persist_safety_backup(safety_payload, safety_directory)
        result = _apply_restore(session, validated, runtime)
        result["safety_backup_path"] = str(safety_path)
        return result

    return run_write(db, operation)


__all__ = [
    "AmbiguousTargetError",
    "BackupValidationError",
    "RevisionConflictError",
    "persist_safety_backup",
    "preview_legacy_restore",
    "restore_legacy_backup",
]
