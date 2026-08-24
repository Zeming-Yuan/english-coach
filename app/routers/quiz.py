import random

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.card import Card
from app.services.error_tracking import record_error
from app.services.scoring import make_fill_prompt, normalize

router = APIRouter()


class TypingCheckIn(BaseModel):
    card_id: int
    user_input: str


@router.post("/typing/check")
def check_typing(payload: TypingCheckIn, db: Session = Depends(get_db)):
    card = db.execute(select(Card).where(Card.id == payload.card_id)).scalars().first()
    if card is None:
        raise HTTPException(status_code=404, detail="Card not found")
    correct = normalize(payload.user_input) == normalize(card.word)
    # 错词追踪：答错加权，答对减权（错误增强效应）
    record_error(db, payload.card_id, is_correct=correct)
    db.commit()
    return {
        "correct": correct,
        "expected": normalize(card.word),
        "normalized_answer": normalize(payload.user_input),
    }


@router.get("/quiz")
def get_quiz(limit: int = 5, db: Session = Depends(get_db)):
    # 1. 全库随机抽 5 张卡（random.shuffle 后取前 limit）
    cards = db.execute(select(Card).order_by(Card.id)).scalars().all()
    selected = random.sample(cards, min(limit, len(cards)))

    # 2. 前 3 张 → cn2en，第 4 张 → choice，第 5 张 → fill
    questions = []
    for i, card in enumerate(selected[:3]):
        questions.append(
            {
                "id": f"cn2en-{i + 1}",
                "type": "cn2en",
                "prompt": card.meaning,
                "card_id": card.id,
                "word_length": len(card.word),
            }
        )

    # choice: 干扰项从全库抽 3 个 word ≠ 正确答案
    if len(selected) >= 4:
        card = selected[3]
        others = [c.word for c in cards if c.id != card.id]
        distractors = random.sample(others, 3) if len(others) >= 3 else others
        options = [card.word] + distractors
        random.shuffle(options)
        questions.append(
            {
                "id": "choice-1",
                "type": "choice",
                "prompt": card.meaning,
                "card_id": card.id,
                "options": options,
            }
        )
        # fill:example 挖掉第一次出现的 word
        if len(selected) >= 5:
            card = selected[4]
            questions.append(
                {
                    "id": "fill-1",
                    "type": "fill",
                    "prompt": make_fill_prompt(card.example, card.word),
                    "card_id": card.id,
                    "word_length": len(card.word),
                    "hint": card.meaning,  # 中文释义：让用户知道要填哪个词
                }
            )
    return {"questions": questions}


class QuizAnswerIn(BaseModel):
    card_id: int
    user_input: str


class QuizScoreIn(BaseModel):
    answers: list[QuizAnswerIn]


@router.post("/quiz/score")
def score_quiz(payload: QuizScoreIn, db: Session = Depends(get_db)):
    correct = 0
    details = []
    for a in payload.answers:
        card = db.execute(select(Card).where(Card.id == a.card_id)).scalars().first()
        if card is None:
            continue
        ok = normalize(a.user_input) == normalize(card.word)
        correct += ok
        # 错词追踪：答错加权，答对减权
        record_error(db, a.card_id, is_correct=ok)
        details.append({"card_id": a.card_id, "correct": ok, "expected": card.word})
    db.commit()
    total = len(payload.answers)
    score = round(correct / total * 100) if total > 0 else 0
    return {"total": total, "correct": correct, "score": score, "details": details}
