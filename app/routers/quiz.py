import logging
import random
import re
from collections.abc import Sequence

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.card import Card
from app.runtime import Runtime, get_runtime
from app.schemas.learning import AttemptCommand, TypingCheckIn
from app.services.content_revisions import content_revision_map
from app.services.learning import (
    CardNotFoundError,
    SubmissionConflictError,
    submit_attempt,
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


def _option_key(word: str) -> str:
    return " ".join(normalize(word).split())


_GLOSS_SEPARATOR = re.compile(r"[,，;；、/／。]+")
_PART_OF_SPEECH = re.compile(
    r"^(?:n|v|vi|vt|adj|adv|prep|pron|conj|det|int)\.[\s.]*"
    r"|[（(](?:名词|动词|形容词|副词|介词|代词|连词)[）)]"
)


def _quiz_glosses(meaning: str | None) -> set[str]:
    return {
        gloss
        for part in _GLOSS_SEPARATOR.split(meaning or "")
        if (gloss := _PART_OF_SPEECH.sub("", part.strip().casefold()).strip())
    }


def _related_question(cards: Sequence[Card]) -> tuple[Card, str, str, list[str]] | None:
    vocabulary: dict[str, set[str]] = {}
    vocabulary_words: dict[str, str] = {}
    for card in cards:
        form = _option_key(card.word)
        if form:
            vocabulary.setdefault(form, set()).update(_quiz_glosses(card.meaning))
            vocabulary_words.setdefault(form, card.word.strip())

    for card in random.sample(cards, len(cards)):
        related: dict[str, tuple[str, str]] = {}
        meanings: dict[str, set[str]] = {}
        original = _option_key(card.word)
        rows = card.related_words
        if not isinstance(rows, list):
            continue
        for row in rows:
            if not isinstance(row, dict) or row.get("kind") == "formation":
                continue
            word, meaning = row.get("word"), row.get("meaning")
            if not isinstance(word, str) or not isinstance(meaning, str):
                continue
            form, glosses = _option_key(word), _quiz_glosses(meaning)
            if not form or form == original or not glosses:
                continue
            related.setdefault(form, (word.strip(), meaning.strip()))
            meanings.setdefault(form, set()).update(glosses)

        for form, (expected, meaning) in related.items():
            glosses = _quiz_glosses(meaning)
            # Prefer related words. Only definitions of offered options can conflict.
            related_options = {
                other: word for other, (word, _) in related.items() if other != form
            }
            if any(
                glosses & (meanings[other] | vocabulary.get(other, set()))
                for other in related_options
            ):
                continue
            distractors = list(related_options.values())
            if not distractors:
                distractors = [
                    vocabulary_words[other]
                    for other, other_glosses in vocabulary.items()
                    if other not in (form, original)
                    and other_glosses
                    and not glosses & other_glosses
                ]
            if distractors:
                prompt = f"「{card.word}」的哪个相关词意思是「{meaning}」？"
                return card, prompt, expected, _choice_options(expected, distractors)
    return None


@router.post("/typing/check")
def check_typing(
    payload: TypingCheckIn,
    db: Session = Depends(get_db),
    runtime: Runtime = Depends(get_runtime),
):
    """输入题一次提交：判分、事件、错词与必要排期同一事务保存。"""
    cmd = AttemptCommand(
        **payload.model_dump(exclude={"user_input", "answer", "kind"}),
        answer=None if payload.skipped else payload.user_input,
        kind=payload.kind,
    )
    try:
        result = submit_attempt(db, cmd, runtime)
    except QuestionTokenStale as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except CardNotFoundError as error:
        raise HTTPException(status_code=404, detail="Card not found") from error
    except SubmissionConflictError as error:
        raise HTTPException(
            status_code=409,
            detail="该提交标识已用于不同内容，请刷新后重试",
        ) from error
    except Exception:
        # 数据库故障：只返回通用失败，不泄露内部异常，也不假装已完成。
        logger.exception("typing submission failed")
        raise HTTPException(status_code=500, detail="保存失败，请重试") from None

    data = result.model_dump(mode="json")
    data["normalized_answer"] = normalize(payload.user_input)
    return data


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
    related = _related_question(cards) if len(selected) >= 5 else None
    related_index = 5 if len(selected) >= 6 else 3
    if related is not None:
        source = related[0]
        if source in selected:
            current = selected.index(source)
            selected[current], selected[related_index] = selected[related_index], source
        else:
            selected[related_index] = source
    revisions = content_revision_map(db, "card", [c.id for c in selected])

    questions = []
    for index, card in enumerate(selected[:6]):
        revision = revisions[card.id]
        common = {"card_id": card.id, "content_revision": revision}
        if index < 3:
            questions.append(
                {
                    **common,
                    "id": f"cn2en-{index + 1}",
                    "type": "cn2en",
                    "prompt": card.meaning,
                    "word_length": len(card.word),
                    "word": card.word,
                }
            )
        elif index == 4:
            questions.append(
                {
                    **common,
                    "id": "fill-1",
                    "type": "fill",
                    "prompt": make_fill_prompt(card.example, card.word),
                    "word_length": len(card.word),
                    "word": card.word,
                    "hint": card.meaning,
                }
            )
        else:
            if related is not None and index == related_index:
                _, prompt, expected, options = related
                kind = "related"
            elif index == 3:
                prompt, expected = card.meaning, card.word
                options = _choice_options(
                    expected, [c.word for c in cards if c.id != card.id]
                )
                kind = "choice"
            else:
                continue
            if len(options) < 2:
                continue
            issued = issue_question(
                card,
                kind,
                options,
                expected,
                runtime.question_secret,
                revision=revision,
                now=runtime.clock.now(),
            )
            question = {
                **common,
                "id": f"{kind}-1",
                "type": kind,
                "prompt": prompt,
                "options": options,
                "question_token": issued["token"],
            }
            if kind == "related":
                question["answer"] = (
                    expected  # Legacy response field; grading uses the token.
                )
            questions.append(question)
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
    revisions = content_revision_map(db, "card", [c.id for c in selected])
    questions = []
    for card in selected:
        options = _choice_options(card.word, [c.word for c in cards if c.id != card.id])
        if len(options) < 2:
            # 无法形成有效干扰项时不发出虚假的单选题。
            continue
        issued = issue_question(
            card,
            "choice",
            options,
            card.word,
            runtime.question_secret,
            revision=revisions[card.id],
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
                "content_revision": revisions[card.id],
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
    except CardNotFoundError as error:
        raise HTTPException(status_code=404, detail="Card not found") from error
    except (QuestionTokenExpired, QuestionTokenStale) as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except InvalidQuestionToken as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except SubmissionConflictError as error:
        raise HTTPException(
            status_code=409, detail="该提交标识已用于不同内容，请重新加载题目"
        ) from error
    except Exception:
        logger.exception("quiz batch submission failed")
        raise HTTPException(status_code=500, detail="保存失败，请重试") from None

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
