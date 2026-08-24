"""导出/导入路由：全量备份 JSON + Anki CSV + 恢复导入。"""

import csv
import io
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.card import Card
from app.models.error_card import ErrorCard
from app.models.memo import Memo
from app.models.review import Review

router = APIRouter()


def _parse_dt(v):
    """解析 ISO 日期（容错 None/非法）。"""
    if not v:
        return None
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00")).replace(
            tzinfo=None
        )
    except ValueError:
        return None


class ImportIn(BaseModel):
    """导入备份请求体（与 /api/export/cards 输出同构）。"""

    cards: list[dict] = []
    reviews: list[dict] = []
    memos: list[dict] = []
    errors: list[dict] = []


@router.post("/import/cards")
def import_cards(payload: ImportIn, db: Session = Depends(get_db)):
    """导入备份：按 word 去重，缺失卡重建，复习/记忆法/错词回写。"""
    # 清空关联表（全量恢复语义）
    db.execute(delete(Review))
    db.execute(delete(Memo))
    db.execute(delete(ErrorCard))
    # 词卡：按 word 复用已有卡或重建（列表按 word 去重）
    word_to_id = {}
    new_words = 0
    seen = set()
    for c in payload.cards:
        w = (c.get("word") or "").strip()
        if not w or w in seen:
            continue
        seen.add(w)
        existing = db.execute(
            select(Card).where(Card.word == w, Card.kind == c.get("kind", "word"))
        ).scalars().first()
        if existing:
            word_to_id[w] = existing.id
            continue
        card = Card(
            word=w,
            phonetic=c.get("phonetic"),
            meaning=c.get("meaning"),
            example=c.get("example"),
            example_cn=c.get("example_cn"),
            contexts=c.get("contexts"),
            kind=c.get("kind", "word"),
            explanation=c.get("explanation"),
        )
        word_to_id.pop(w, None)
        db.add(card)
        db.flush()
        word_to_id[w] = card.id
        new_words += 1
    db.commit()  # 卡片就位

    # 复习记录回写（old card_id → new id 映射由 word 兜底：按 review.card_id 查旧卡名）
    old_id_to_word = {c.get("id"): c.get("word") for c in payload.cards}
    for r in payload.reviews:
        word = old_id_to_word.get(r.get("card_id"))
        if not word or word not in word_to_id:
            continue
        due = _parse_dt(r.get("due")) or datetime.now(timezone.utc).replace(
            tzinfo=None
        )
        db.add(
            Review(
                card_id=word_to_id[word],
                state=int(r.get("state", 0)),
                step=r.get("step"),
                due=due,
                stability=float(r.get("stability", 1.0)),
                difficulty=float(r.get("difficulty", 1.0)),
                elapsed_days=int(r.get("elapsed_days", 0)),
                last_review=_parse_dt(r.get("last_review")),
                review_count=int(r.get("review_count", 1)),
                rating=r.get("rating"),
            )
        )
    for m in payload.memos:
        word = old_id_to_word.get(m.get("card_id"))
        if word and word in word_to_id and m.get("content"):
            db.add(Memo(card_id=word_to_id[word], content=m["content"]))
    for e in payload.errors:
        word = old_id_to_word.get(e.get("card_id"))
        if word and word in word_to_id:
            db.add(
                ErrorCard(card_id=word_to_id[word], error_count=int(e.get("error_count", 1)))
            )
    db.commit()
    return {"imported_words": new_words, "requests": len(payload.cards)}


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
