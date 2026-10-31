"""完整 V2 备份：一次逻辑一致的数据库学习内容快照。

只导出白名单模型（不遍历任意表，不包含密钥、环境配置、语音缓存或浏览器偏好）。
`semantic_snapshot` 仅剔除导出时间；`snapshot_revision` 提供规范化内容摘要，
供后续恢复比对业务数据是否等价。
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC

from fastapi.encoders import jsonable_encoder
from sqlalchemy import inspect, literal_column, select, text
from sqlalchemy.orm import Session

from app.models.card import Card
from app.models.content_revision import ContentRevision
from app.models.error_card import ErrorCard
from app.models.hard_card import HardCard
from app.models.lesson import Lesson
from app.models.memo import Memo
from app.models.review import Review
from app.models.review_baseline import ReviewBaseline
from app.models.review_event import ReviewEvent
from app.models.story import Story, StoryWord
from app.runtime import Runtime

BACKUP_VERSION = 3

# V3 扩展集合：每个集合必须同时在 app.schemas.backup_v3 登记。
EXTENSION_COLLECTIONS = (("content_revisions", ContentRevision),)

# 明确的模型白名单：新增业务表必须在这里显式登记才会进入备份。
BACKUP_COLLECTIONS = (
    ("cards", Card),
    ("reviews", Review),
    ("learning_events", ReviewEvent),
    ("review_baselines", ReviewBaseline),
    ("memos", Memo),
    ("errors", ErrorCard),
    ("hard_cards", HardCard),
    ("lessons", Lesson),
    ("stories", Story),
    ("story_words", StoryWord),
)


def export_rows(db: Session, model) -> list[dict]:
    """事件按时间与保存次序导出，其余按 id；保留同时间事件的先后。"""
    columns = inspect(model).columns
    order = (
        (ReviewEvent.occurred_at, literal_column("review_events.rowid"))
        if model is ReviewEvent
        else (model.id,)
    )
    return [
        jsonable_encoder({column.key: getattr(row, column.key) for column in columns})
        for row in db.scalars(select(model).order_by(*order))
    ]


def export_backup(db: Session, runtime: Runtime) -> dict:
    """读取全部集合，形成同一读事务内的逻辑快照。

    干净会话显式 BEGIN（SQLite 读事务）；调用者已有事务时复用，不自行 commit。
    """
    started = False
    if not db.in_transaction():
        db.execute(text("BEGIN"))
        started = True
    from app.schemas.backup_v3 import registered_extensions

    registered = set(registered_extensions())
    declared = {name for name, _ in EXTENSION_COLLECTIONS}
    if registered != declared:
        raise RuntimeError(
            "V3 扩展集合与登记表不一致："
            f"registered={sorted(registered)} declared={sorted(declared)}"
        )
    try:
        payload = {
            "version": BACKUP_VERSION,
            "exported_at": runtime.clock.now().astimezone(UTC).isoformat(),
            "learning_timezone": runtime.learning_timezone,
            "features": [name for name, _ in EXTENSION_COLLECTIONS],
            "extensions": {
                name: export_rows(db, model) for name, model in EXTENSION_COLLECTIONS
            },
            **{name: export_rows(db, model) for name, model in BACKUP_COLLECTIONS},
        }
    finally:
        if started:
            db.rollback()
    return payload


def semantic_snapshot(payload: dict) -> dict:
    """业务内容快照：仅排除导出时间，保留学习事件数组次序。"""
    return {key: value for key, value in payload.items() if key != "exported_at"}


def _canonical_rows(value, key: str | None = None):
    """集合按 id 排序；事件保持保存次序，标量与 features 保持原样。"""
    if isinstance(value, dict):
        return {item: _canonical_rows(rows, item) for item, rows in value.items()}
    if (
        isinstance(value, list)
        and key != "learning_events"
        and all(isinstance(row, dict) and "id" in row for row in value)
    ):
        return sorted(value, key=lambda row: row["id"])
    return value


def snapshot_revision(payload: dict) -> str:
    """内容摘要保留事件保存次序，其余集合按 id；JSON 排序键后取 SHA256。"""
    canonical = _canonical_rows(semantic_snapshot(payload))
    encoded = json.dumps(
        canonical,
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
        default=str,
    )
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()
