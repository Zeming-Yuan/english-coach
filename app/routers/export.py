"""导出/导入路由：V2 完整备份 + 旧版卡片 JSON（非完整）+ Anki CSV + 恢复导入。"""

import csv
import io
import json
import logging
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.card import Card
from app.models.error_card import ErrorCard
from app.models.memo import Memo
from app.models.review import Review
from app.runtime import Runtime, get_runtime
from app.schemas.backup import BackupValidationError, UnsupportedBackupError
from app.services.backup import export_backup
from app.services.card_payload import backup_payload
from app.services.restore import (
    AmbiguousTargetError,
    RevisionConflictError,
    preview_legacy_restore,
    restore_legacy_backup,
)

router = APIRouter()
logger = logging.getLogger(__name__)


def _safety_directory(db: Session) -> Path:
    """恢复前备份目录与应用数据库同目录，测试不会写到用户 data/。"""
    database = db.get_bind().url.database
    if database and database != ":memory:":
        return Path(database).parent / "backups"
    return Path("./data/backups")


def _restore_error(error: Exception) -> HTTPException:
    if isinstance(error, BackupValidationError):
        return HTTPException(status_code=422, detail=error.issues)
    if isinstance(error, (UnsupportedBackupError, AmbiguousTargetError)):
        return HTTPException(status_code=422, detail=str(error))
    if isinstance(error, RevisionConflictError):
        return HTTPException(status_code=409, detail=str(error))
    logger.exception("legacy restore failed")
    return HTTPException(status_code=500, detail="恢复失败，原数据未改变")


@router.post("/import/preview")
def preview_import(
    payload: dict,
    db: Session = Depends(get_db),
    runtime: Runtime = Depends(get_runtime),
):
    """只读预览旧版部分恢复的范围与影响。"""
    try:
        return preview_legacy_restore(db, payload, runtime)
    except Exception as error:  # 统一映射为结构化错误
        raise _restore_error(error) from error


@router.post("/import/cards")
def import_cards(
    payload: dict,
    db: Session = Depends(get_db),
    runtime: Runtime = Depends(get_runtime),
):
    """旧版部分恢复：先校验，再在单一事务中写入；失败不改变原数据。"""
    if "backup" in payload:
        backup = payload.get("backup")
        expected_revision = payload.get("expected_revision")
        if not isinstance(backup, dict):
            raise HTTPException(status_code=422, detail="backup 必须是对象")
    else:
        backup = payload
        expected_revision = None
    try:
        return restore_legacy_backup(
            db, backup, expected_revision, runtime, _safety_directory(db)
        )
    except Exception as error:  # 统一映射为结构化错误
        raise _restore_error(error) from error


@router.get("/export/backup")
def export_backup_endpoint(
    db: Session = Depends(get_db),
    runtime: Runtime = Depends(get_runtime),
):
    """完整 V2 备份：版本、导出时间、学习时区与全部学习内容及关联。"""
    payload = export_backup(db, runtime)
    raw = json.dumps(payload, ensure_ascii=False, indent=1).encode("utf-8")
    return StreamingResponse(
        iter([raw]),
        media_type="application/json",
        headers={
            "Content-Disposition": 'attachment; filename="english-coach-backup.json"'
        },
    )


@router.get("/export/cards")
def export_cards(db: Session = Depends(get_db)):
    """旧导出格式：词卡 + 复习记录 + 记忆法 + 错词（兼容保留，非完整备份）。"""
    cards = db.execute(select(Card).order_by(Card.id)).scalars().all()
    reviews = db.execute(select(Review).order_by(Review.card_id)).scalars().all()
    memos = db.execute(select(Memo)).scalars().all()
    errors = db.execute(select(ErrorCard)).scalars().all()

    def dt(v):
        return v.isoformat() if v else None

    payload = {
        "exported_at": None,  # 占位
        "cards": [backup_payload(c) for c in cards],
        "reviews": [
            {
                "card_id": r.card_id,
                "state": r.state,
                "step": r.step,
                "due": dt(r.due),
                "stability": r.stability,
                "difficulty": r.difficulty,
                "elapsed_days": r.elapsed_days,
                "last_review": dt(r.last_review),
                "review_count": r.review_count,
                "rating": r.rating,
            }
            for r in reviews
        ],
        "memos": [
            {"card_id": m.card_id, "content": m.content} for m in memos
        ],
        "errors": [
            {"card_id": e.card_id, "error_count": e.error_count} for e in errors
        ],
    }

    raw = json.dumps(payload, ensure_ascii=False, indent=1).encode("utf-8")
    return StreamingResponse(iter([raw]), media_type="application/json")

@router.get("/export/anki")
def export_anki(db: Session = Depends(get_db)):
    """Anki CSV：word | 音标 + 释义 + 例句 + 中文（导入 Anki 用）。"""
    cards = (
        db.execute(select(Card).where(Card.kind == "word").order_by(Card.word))
        .scalars()
        .all()
    )
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["word", "phonetic", "meaning", "example", "example_cn"])
    for c in cards:
        writer.writerow([
            c.word,
            c.phonetic or "",
            c.meaning or "",
            c.example or "",
            c.example_cn or "",
        ])
    # UTF-8 BOM：Excel/Anki 中文不乱码
    raw = ("﻿" + buf.getvalue()).encode("utf-8")
    return StreamingResponse(
        iter([raw]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=englishcoach_anki.csv"},
    )
