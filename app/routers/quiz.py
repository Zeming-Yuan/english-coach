import logging
import random

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.card import Card
from app.runtime import Runtime, get_runtime
from app.schemas.learning import AttemptCommand
from app.services.error_tracking import record_error
from app.services.learning import (
    CardNotFoundError,
    SubmissionConflictError,
    submit_batch,
)
from app.services.questions import (
    InvalidQuestionToken,
    QuestionTokenExpired,
    QuestionTokenStale,
    issue_question,
)
from app.services.scoring import make_fill_prompt, normalize

router = APIRouter()
logger = logging.getLogger(__name__)


def _choice_options(answer: str, candidates: list[str]) -> list[str]:
    """最多 4 个不重复选项；干扰不足时返回可判断的较小选项集。"""
    seen = {answer}
    distractors = []
    for candidate in candidates:
        if candidate and candidate not in seen:
            seen.add(candidate)
            distractors.append(candidate)
    random.shuffle(distractors)
    options = [answer, *distractors[:3]]
    random.shuffle(options)
    return options


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
def get_quiz(
    limit: int = 5,
    db: Session = Depends(get_db),
    runtime: Runtime = Depends(get_runtime),
):
    # 1. 只抽单词卡（句子卡的释义是整句翻译，不适合单格拼写/选择）
    cards = (
        db.execute(select(Card).where(Card.kind == "word").order_by(Card.id))
        .scalars()
        .all()
    )
    selected = random.sample(cards, min(limit, len(cards)))

    # 2. 前 3 张 → cn2en，第 4 张 → choice，第 5 张 → fill
    # note: 下发 word 供前端拼写格子实时红/绿着色（本地自用工具，无防作弊需求）
    questions = []
    for i, card in enumerate(selected[:3]):
        questions.append(
            {
                "id": f"cn2en-{i + 1}",
                "type": "cn2en",
                "prompt": card.meaning,
                "card_id": card.id,
                "word_length": len(card.word),
                "word": card.word,
            }
        )

    # choice: 干扰项从全库抽 3 个 word ≠ 正确答案；无法形成选择时不发假题
    if len(selected) >= 4:
        card = selected[3]
        options = _choice_options(
            card.word, [c.word for c in cards if c.id != card.id]
        )
        if len(options) >= 2:
            issued = issue_question(
                card,
                "choice",
                options,
                card.word,
                runtime.question_secret,
                now=runtime.clock.now(),
            )
            questions.append(
                {
                    "id": "choice-1",
                    "type": "choice",
                    "prompt": card.meaning,
                    "card_id": card.id,
                    "options": options,
                    "question_token": issued["token"],
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
                    "word": card.word,
                    "hint": card.meaning,  # 中文释义：让用户知道要填哪个词
                }
            )
            # related: 相关词选择题；标准答案是相关词而不是原词
            if len(selected) >= 6:
                card = selected[5]
                related = [
                    item
                    for item in (card.related_words or [])
                    if isinstance(item, dict) and item.get("word")
                ]
                if related:
                    rw = random.choice(related)
                    expected = str(rw["word"])
                    candidates = [
                        str(item["word"])
                        for item in related
                        if str(item["word"]) != expected
                    ]
                    candidates += [c.word for c in cards if c.word != expected]
                    options = _choice_options(expected, candidates)
                    if expected and len(options) >= 2:
                        issued = issue_question(
                            card,
                            "related",
                            options,
                            expected,
                            runtime.question_secret,
                            now=runtime.clock.now(),
                        )
                        questions.append(
                            {
                                "id": "related-1",
                                "type": "related",
                                "prompt": (
                                    f"「{card.word}」的哪个相关词意思是"
                                    f"「{rw.get('meaning') or ''}」？"
                                ),
                                "card_id": card.id,
                                "options": options,
                                "question_token": issued["token"],
                                # 旧字段仅兼容；判分只用签名上下文。
                                "answer": expected,
                            }
                        )
    return {"questions": questions}


@router.get("/quiz/choice")
def get_choice_quiz(
    limit: int = 4,
    db: Session = Depends(get_db),
    runtime: Runtime = Depends(get_runtime),
):
    """纯选择题（看中文选英文）：混合练习用，一次抽多道。

    与 /quiz 不同：不掺 cn2en/fill/related，每张卡都是 choice 型，
    这样混合练习可以独立控制选择题的数量。
    """
    cards = (
        db.execute(select(Card).where(Card.kind == "word").order_by(Card.id))
        .scalars()
        .all()
    )
    selected = random.sample(cards, min(limit, len(cards)))
    questions = []
    for card in selected:
        options = _choice_options(
            card.word, [c.word for c in cards if c.id != card.id]
        )
        if len(options) < 2:
            # 无法形成有效干扰项时不发出虚假的单选题。
            continue
        issued = issue_question(
            card,
            "choice",
            options,
            card.word,
            runtime.question_secret,
            now=runtime.clock.now(),
        )
        questions.append(
            {
                "id": f"choice-{card.id}",
                "type": "choice",
                "prompt": card.meaning,
                "card_id": card.id,
                "options": options,
                "question_token": issued["token"],
            }
        )
    return {"questions": questions}


class QuizScoreIn(BaseModel):
    """批量选择提交：每项独立 submission_id，整批原子保存。"""

    answers: list[AttemptCommand]


@router.post("/quiz/score")
def score_quiz(
    payload: QuizScoreIn,
    db: Session = Depends(get_db),
    runtime: Runtime = Depends(get_runtime),
):
    try:
        results = submit_batch(db, payload.answers, runtime)
    except CardNotFoundError:
        raise HTTPException(status_code=404, detail="Card not found")
    except (QuestionTokenExpired, QuestionTokenStale) as error:
        raise HTTPException(status_code=409, detail=str(error))
    except InvalidQuestionToken as error:
        raise HTTPException(status_code=422, detail=str(error))
    except SubmissionConflictError:
        raise HTTPException(
            status_code=409, detail="该提交标识已用于不同内容，请重新加载题目"
        )
    except Exception:
        logger.exception("quiz batch submission failed")
        raise HTTPException(status_code=500, detail="保存失败，请重试")

    details = [
        {
            "card_id": result.card_id,
            "correct": result.correct,
            "expected": result.expected,
            "committed": result.committed,
            "scheduled": result.scheduled,
            "event_id": result.event_id,
        }
        for result in results
    ]
    total = len(results)
    correct = sum(1 for result in results if result.correct)
    score = round(correct / total * 100) if total > 0 else 0
    return {"total": total, "correct": correct, "score": score, "details": details}
