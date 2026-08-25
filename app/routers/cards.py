"""词卡路由：生成词卡 + 单词本列表。"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.card import Card
from app.models.error_card import ErrorCard
from app.models.hard_card import HardCard
from app.models.memo import Memo
from app.models.review import Review
from app.services.card_generator import generate_cards, regenerate_example

router = APIRouter()


class GenerateCardsIn(BaseModel):
    """生成词卡请求体。"""

    words: list[str] = Field(min_length=1, max_length=20)


class UpdateCardIn(BaseModel):
    """词卡编辑请求体：字段可部分更新。"""

    meaning: str | None = Field(default=None, max_length=500)
    phonetic: str | None = Field(default=None, max_length=50)
    example: str | None = Field(default=None, max_length=500)
    example_cn: str | None = Field(default=None, max_length=500)
    explanation: str | None = Field(default=None, max_length=500)


@router.post("/cards/{card_id}/hard")
def toggle_hard(card_id: int, db: Session = Depends(get_db)):
    """切换困难词标记（自主增强：优先重现）。"""
    card = db.get(Card, card_id)
    if card is None:
        raise HTTPException(status_code=404, detail="Card not found")
    row = (
        db.execute(select(HardCard).where(HardCard.card_id == card_id))
        .scalars()
        .first()
    )
    if row:
        db.delete(row)
        db.commit()
        return {"card_id": card_id, "is_hard": False}
    db.add(HardCard(card_id=card_id))
    db.commit()
    return {"card_id": card_id, "is_hard": True}


@router.put("/cards/{card_id}")
def update_card(card_id: int, payload: UpdateCardIn, db: Session = Depends(get_db)):
    """编辑词卡（用户纠正 AI 生成错误）。"""
    card = db.get(Card, card_id)
    if card is None:
        raise HTTPException(status_code=404, detail="Card not found")
    data = payload.model_dump(exclude_none=True)
    for field, value in data.items():
        setattr(card, field, value)
    db.commit()
    return card_to_dict(card, db)


@router.delete("/cards/{card_id}")
def delete_card(card_id: int, db: Session = Depends(get_db)):
    """删除词卡（级联清复习/记忆法/错词/故事关联）。"""
    card = db.get(Card, card_id)
    if card is None:
        raise HTTPException(status_code=404, detail="Card not found")
    from app.models.story import StoryWord

    db.execute(Review.__table__.delete().where(Review.card_id == card_id))
    db.execute(Memo.__table__.delete().where(Memo.card_id == card_id))
    db.execute(ErrorCard.__table__.delete().where(ErrorCard.card_id == card_id))
    db.execute(HardCard.__table__.delete().where(HardCard.card_id == card_id))
    db.execute(StoryWord.__table__.delete().where(StoryWord.card_id == card_id))
    db.delete(card)
    db.commit()
    return {"deleted": card_id}


def card_to_dict(card: Card, db: Session) -> dict:
    """Card → 字典（含复习状态）。"""
    review = (
        db.execute(
            select(Review).where(Review.card_id == card.id).order_by(Review.id.desc())
        )
        .scalars()
        .first()
    )
    error = (
        db.execute(select(ErrorCard).where(ErrorCard.card_id == card.id))
        .scalars()
        .first()
    )
    hard = (
        db.execute(select(HardCard).where(HardCard.card_id == card.id))
        .scalars()
        .first()
    )
    return {
        "id": card.id,
        "word": card.word,
        "kind": card.kind,
        "phonetic": card.phonetic,
        "meaning": card.meaning,
        "example": card.example,
        "example_cn": card.example_cn,
        "explanation": card.explanation,
        "contexts": card.contexts,
        "review_count": review.review_count if review else 0,
        "graduated": review.state == 2 if review else False,
        "error_count": error.error_count if error else 0,
        "is_hard": hard is not None,
    }


def _card_to_dict_fast(card: Card, review: Review | None, error: ErrorCard | None, is_hard: bool) -> dict:
    """Card → 字典（批量预加载版本，无额外查询）。"""
    return {
        "id": card.id,
        "word": card.word,
        "kind": card.kind,
        "phonetic": card.phonetic,
        "meaning": card.meaning,
        "example": card.example,
        "example_cn": card.example_cn,
        "explanation": card.explanation,
        "contexts": card.contexts,
        "review_count": review.review_count if review else 0,
        "graduated": review.state == 2 if review else False,
        "error_count": error.error_count if error else 0,
        "is_hard": is_hard,
    }


@router.post("/cards/generate")
def generate(req: GenerateCardsIn, db: Session = Depends(get_db)):
    """AI 批量生成词卡（已存在的词跳过）。"""
    try:
        cards = generate_cards(req.words, db)
    except ValueError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {
        "generated": len(cards),
        "skipped": len(req.words) - len(cards),
        "cards": [card_to_dict(c, db) for c in cards],
    }


@router.post("/cards/{card_id}/regenerate")
def regenerate_card_example(card_id: int, db: Session = Depends(get_db)):
    """换一个例句：重新生成例句/翻译/讲解并更新卡。"""
    card = db.get(Card, card_id)
    if card is None:
        raise HTTPException(status_code=404, detail="Card not found")
    try:
        example, example_cn, explanation = regenerate_example(card.word)
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=502, detail=str(e))
    if example:
        card.example = example
        card.example_cn = example_cn
        card.explanation = explanation
        db.commit()
    return card_to_dict(card, db)


@router.get("/cards")
def list_cards(db: Session = Depends(get_db)):
    """单词本：全库卡片，按创建时间倒序。"""
    cards = (
        db.execute(select(Card).order_by(Card.created_at.desc(), Card.id.desc()))
        .scalars()
        .all()
    )
    if not cards:
        return {"cards": []}
    # 批量预加载关联数据，消除 N+1 查询
    card_ids = [c.id for c in cards]
    reviews = db.execute(
        select(Review).where(Review.card_id.in_(card_ids))
    ).scalars().all()
    errors = db.execute(
        select(ErrorCard).where(ErrorCard.card_id.in_(card_ids))
    ).scalars().all()
    hards = db.execute(
        select(HardCard).where(HardCard.card_id.in_(card_ids))
    ).scalars().all()
    # 构建查找表：每个 card_id 取最新 review
    review_map: dict[int, Review] = {}
    for r in reviews:
        if r.card_id not in review_map or r.id > review_map[r.card_id].id:
            review_map[r.card_id] = r
    error_map = {e.card_id: e for e in errors}
    hard_set = {h.card_id for h in hards}

    return {
        "cards": [
            _card_to_dict_fast(c, review_map.get(c.id), error_map.get(c.id), c.id in hard_set)
            for c in cards
        ]
    }


@router.post("/cards/refresh-examples")
def refresh_examples(limit: int = 10, db: Session = Depends(get_db)):
    """批量刷新旧词卡的例句/讲解（旧 prompt 生成的平淡句）。

    找出 example 长度 < 30 或 explanation 不含 | 的 word 类型卡，
    调 regenerate_example 更新，每批最多 limit 个。
    """
    from app.services.card_generator import regenerate_example

    # 找需要刷新的卡
    all_words = db.execute(
        select(Card).where(Card.kind == "word")
    ).scalars().all()

    needs_refresh = []
    for c in all_words:
        example = c.example or ""
        explanation = c.explanation or ""
        if len(example) < 30 or "|" not in explanation:
            needs_refresh.append(c)

    if not needs_refresh:
        return {"refreshed": 0, "remaining": 0, "total_weak": 0}

    batch = needs_refresh[:limit]
    refreshed = 0
    for card in batch:
        try:
            example, example_cn, explanation = regenerate_example(card.word)
            if example:
                card.example = example
                card.example_cn = example_cn
                card.explanation = explanation
                refreshed += 1
        except Exception:
            continue  # 单个失败不阻塞整批

    db.commit()
    return {
        "refreshed": refreshed,
        "remaining": len(needs_refresh) - refreshed,
        "total_weak": len(needs_refresh),
    }


@router.get("/cards/{card_id}")
def get_card_detail(card_id: int, db: Session = Depends(get_db)):
    """单词详情：全部字段 + 复习历史 + 毕业状态。"""
    card = db.get(Card, card_id)
    if card is None:
        raise HTTPException(status_code=404, detail="Card not found")

    # 复习记录（最新在前）
    reviews = (
        db.execute(
            select(Review).where(Review.card_id == card_id).order_by(Review.id.desc())
        )
        .scalars()
        .all()
    )

    latest = reviews[0] if reviews else None
    history = [
        {
            "rating": r.rating,  # 用户评分 1-4（旧数据为 None）
            "state": r.state,  # FSRS 状态（兜底展示）
            "last_review": r.last_review.isoformat() if r.last_review else None,
            "review_count": r.review_count,
        }
        for r in reviews
    ]
    error = (
        db.execute(select(ErrorCard).where(ErrorCard.card_id == card_id))
        .scalars()
        .first()
    )
    memo = (
        db.execute(select(Memo).where(Memo.card_id == card_id)).scalars().first()
    )

    return {
        "id": card.id,
        "word": card.word,
        "kind": card.kind,
        "phonetic": card.phonetic,
        "meaning": card.meaning,
        "example": card.example,
        "example_cn": card.example_cn,
        "explanation": card.explanation,
        "contexts": card.contexts,
        "created_at": card.created_at.isoformat(),
        "graduated": latest.state == 2 if latest else False,
        "review_count": latest.review_count if latest else 0,
        "error_count": error.error_count if error else 0,
        "memo": memo.content if memo else None,
        "next_due": latest.due.isoformat() if latest else None,
        "review_history": history,
    }
