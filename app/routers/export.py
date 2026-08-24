"""导出路由：全量备份 JSON + Anki CSV。"""

import csv
import io
import json

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.card import Card
from app.models.error_card import ErrorCard
from app.models.memo import Memo
from app.models.review import Review

router = APIRouter()


@router.get("/export/cards")
def export_cards(db: Session = Depends(get_db)):
    """全量备份：词卡 + 复习记录 + 记忆法 + 错词。"""
    cards = db.execute(select(Card).order_by(Card.id)).scalars().all()
    reviews = db.execute(select(Review).order_by(Review.card_id)).scalars().all()
    memos = db.execute(select(Memo)).scalars().all()
    errors = db.execute(select(ErrorCard)).scalars().all()

    def dt(v):
        return v.isoformat() if v else None

    payload = {
        "exported_at": None,  # 占位
        "cards": [
            {
                "id": c.id,
                "word": c.word,
                "phonetic": c.phonetic,
                "meaning": c.meaning,
                "example": c.example,
                "example_cn": c.example_cn,
                "contexts": c.contexts,
                "kind": c.kind,
                "explanation": c.explanation,
                "created_at": dt(c.created_at),
            }
            for c in cards
        ],
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
