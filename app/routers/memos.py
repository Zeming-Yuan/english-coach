"""记忆法路由：用户自己写的记忆法（自我解释效应）。"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.card import Card
from app.models.memo import Memo

router = APIRouter()


@router.get("/memos/{card_id}")
def get_memo(card_id: int, db: Session = Depends(get_db)):
    """读某卡的记忆法。"""
    memo = (
        db.execute(select(Memo).where(Memo.card_id == card_id)).scalars().first()
    )
    if memo is None:
        return {"card_id": card_id, "content": None}
    return {"card_id": card_id, "content": memo.content}


class MemoIn(BaseModel):
    """记忆法请求体。"""

    content: str = Field(min_length=1, max_length=500)


@router.put("/memos/{card_id}")
def save_memo(card_id: int, payload: MemoIn, db: Session = Depends(get_db)):
    """保存/覆盖某卡的记忆法。"""
    card = db.get(Card, card_id)
    if card is None:
        raise HTTPException(status_code=404, detail="Card not found")
    memo = (
        db.execute(select(Memo).where(Memo.card_id == card_id)).scalars().first()
    )
    if memo:
        memo.content = payload.content
    else:
        db.add(Memo(card_id=card_id, content=payload.content))
    db.commit()
    return {"card_id": card_id, "content": payload.content}
