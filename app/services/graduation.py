"""词毕业服务：判定词卡是否毕业，毕业则自动生成句子卡。"""

import json

from openai import OpenAI
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models.card import Card
from app.models.review import Review
from app.services.model_router import Task, route

client = OpenAI(api_key=settings.deepseek_api_key, base_url=settings.deepseek_base_url)


def is_graduated(review: Review) -> bool:
    """判定词卡是否毕业：FSRS state == 2 (Review) 或复习次数 >= 3。"""
    # State 枚举（py-fsrs）：0=New, 1=Learning, 2=Review, 3=Relearning
    return review.state == 2 or review.review_count >= 3


def graduate_to_sentence(card: Card, db: Session) -> Card | None:
    """如果词卡毕业且尚未生成过句子卡，则用 AI 生成一个更复杂的句子卡。

    与词卡例句不同，句子卡要求：
    - 更长的句子（15-25 词）
    - 更多上下文和词汇
    - 有故事感或场景感
    """
    # 检查是否已经有句子卡
    existing = (
        db.execute(select(Card).where(Card.word == card.word, Card.kind == "sentence"))
        .scalars()
        .first()
    )
    if existing is not None:
        return None

    # 用 AI 生成更复杂的句子
    try:
        resp = client.chat.completions.create(
            model=route(Task.BULK),
            messages=[
                {
                    "role": "system",
                    "content": (
                        "你是英语老师。为目标单词生成一个用于阅读练习的句子。\n"
                        "【要求】\n"
                        "- 句子 15-25 词，有完整的情境和上下文\n"
                        "- 目标词必须出现在句中\n"
                        "- 用词可以比零基础稍难一点（有 1-2 个生词没关系）\n"
                        "- 有画面感、有故事性，不是简单的陈述句\n"
                        "- 同时提供自然的中文翻译\n"
                        '严格输出 JSON: {"example": "英文句子", "example_cn": "中文翻译"}'
                    ),
                },
                {"role": "user", "content": card.word},
            ],
            response_format={"type": "json_object"},
        )
        content = resp.choices[0].message.content
        if content:
            data = json.loads(content)
            example = data.get("example", "")
            example_cn = data.get("example_cn", "")
            if example:
                sentence_card = Card(
                    word=card.word,
                    phonetic=card.phonetic,
                    meaning=example_cn,
                    example=example,
                    example_cn=example_cn,
                    kind="sentence",
                )
                db.add(sentence_card)
                db.flush()
                return sentence_card
    except Exception:
        pass

    # AI 失败则用词卡例句兜底
    if not card.example:
        return None
    sentence_card = Card(
        word=card.word,
        phonetic=card.phonetic,
        meaning=card.example_cn,
        example=card.example,
        example_cn=card.example_cn,
        kind="sentence",
    )
    db.add(sentence_card)
    db.flush()
    return sentence_card
