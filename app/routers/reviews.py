# 复习提交路由

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.services.review_submission import CardNotFoundError, submit_review

router = APIRouter()


class ReviewRequest(BaseModel):
    """复习提交请求体——rating 只允许 1-4，非法自动 422"""

    card_id: int
    rating: Literal[1, 2, 3, 4]


@router.post("/reviews")
def post_review(req: ReviewRequest, db: Session = Depends(get_db)):
    """提交一次复习：FSRS 写回 + 错词追踪 + 毕业策略（统一见 review_submission）。"""
    try:
        result = submit_review(db, req.card_id, req.rating)
    except CardNotFoundError:
        raise HTTPException(status_code=404, detail="Card not found")
    resp = {"card_id": result.card_id, "next_due": result.next_due}
    if result.graduated:
        resp["graduated"] = True
        resp["sentence_card_id"] = result.sentence_card_id
    return resp
