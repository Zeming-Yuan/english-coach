"""听写练习路由：播发音 → 4 选 1；服务端按签名题目上下文判分。"""

import logging
import random
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.card import Card
from app.models.review import Review
from app.runtime import Runtime, get_runtime
from app.schemas.learning import AttemptCommand
from app.services.learning import (
    CardNotFoundError,
    SubmissionConflictError,
    submit_attempt,
)
from app.services.questions import (
    InvalidQuestionToken,
    QuestionTokenExpired,
    QuestionTokenStale,
    issue_question,
)

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/listening")
def get_listening(
    limit: int = 5,
    db: Session = Depends(get_db),
    runtime: Runtime = Depends(get_runtime),
):
    """从今日队列（新词 + 到期卡）抽词，生成听写题。"""
    # 1. 取今日队列（复用 today 的逻辑）
    now = runtime.clock.now()
    new_cards = (
        db.execute(
            select(Card)
            .outerjoin(Review, Review.card_id == Card.id)
            .where(Review.id.is_(None), Card.kind == "word")
            .order_by(Card.id)
            .limit(limit)
        )
        .scalars()
        .all()
    )
    due_cards = (
        db.execute(
            select(Card)
            .join(Review, Review.card_id == Card.id)
            .where(Review.due <= now, Card.kind == "word")
            .order_by(Review.due)
            .limit(limit)
        )
        .scalars()
        .all()
    )

    # 合并去重，取最多 limit 个
    seen = set()
    pool = []
    for c in list(new_cards) + list(due_cards):
        if c.id not in seen:
            seen.add(c.id)
            pool.append(c)

    # 今日队列为空时，从全库随机取词
    if not pool:
        all_word_cards = (
            db.execute(select(Card).where(Card.kind == "word")).scalars().all()
        )
        pool = random.sample(all_word_cards, min(limit, len(all_word_cards)))

    selected = pool[:limit]
    if not selected:
        return {"questions": []}

    # 2. 干扰项池：全库词卡中未选中的单词（按词去重，选中词本身也不占干扰位）。
    #    注意只排除"选中"的卡——今日池里没入选的剩余词可以当干扰项，
    #    否则词库 <20 词时选项只剩 3 个（旧逻辑 seen 放整个池）。
    all_words = db.execute(select(Card).where(Card.kind == "word")).scalars().all()

    def other_texts(sel: list[Card]) -> list[str]:
        used = {c.word for c in sel}
        return list({c.word for c in all_words if c.word not in used})

    # 干扰项不足 3 个时，减少题目数量把词腾给干扰项（保证每题尽量 4 选项）
    while len(selected) > 1 and len(other_texts(selected)) < 3:
        selected = selected[:-1]
    other_texts = other_texts(selected)

    # 3. 生成题目：每题 4 选项（1 正确 + 最多 3 干扰）；无法形成选择时不出假题。
    questions = []
    for card in selected:
        distractors = random.sample(other_texts, min(3, len(other_texts)))
        options = [card.word] + distractors
        if len(options) < 2:
            continue
        random.shuffle(options)
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
                "card_id": card.id,
                "word": card.word,
                "meaning": card.meaning,
                "options": options,
                # 旧字段仅兼容展示；判分使用签名题目上下文，不采信客户端下标。
                "correct_index": options.index(card.word),
                "question_token": issued["token"],
            }
        )

    return {"questions": questions}


class ListeningScoreIn(AttemptCommand):
    """听写选择提交：answer 为选项文本，服务端按签名上下文判分。"""

    source: Literal["listening"] = "listening"
    kind: Literal["choice"] = "choice"


@router.post("/listening/score")
def score_listening(
    payload: ListeningScoreIn,
    db: Session = Depends(get_db),
    runtime: Runtime = Depends(get_runtime),
):
    """识别题：判分 + 事件 + 错词一次提交；不更新 FSRS。"""
    if not payload.skipped and not payload.question_token:
        raise HTTPException(
            status_code=422, detail="缺少题目上下文，请重新加载题目"
        )
    try:
        result = submit_attempt(db, payload, runtime)
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
        logger.exception("listening submission failed")
        raise HTTPException(status_code=500, detail="保存失败，请重试")

    card = db.get(Card, result.card_id)
    return {
        **result.model_dump(),
        "correct_word": card.word if card is not None else result.expected,
    }
