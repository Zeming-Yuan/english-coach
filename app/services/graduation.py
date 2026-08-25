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

    # 用 AI 生成更复杂的句子（对话体优先 + 意群切分 + 难度标记）
    try:
        resp = client.chat.completions.create(
            model=route(Task.BULK),
            messages=[
                {
                    "role": "system",
                    "content": (
                        "你是零基础英语老师。为目标单词生成一个用于阅读练习的句子。\n"
                        "【要求】\n"
                        "- 优先用对话体（A/B 两人简短来往，有应答、有场景），如：\n"
                        '  A: Look at that cloud! B: It looks like a giant rabbit.\n'
                        "- 若无对话体则用叙述句，15-25 词，有画面感和故事性\n"
                        "- 目标词必须出现在句中\n"
                        "- 用词可以比零基础稍难一点（有 1-2 个生词没关系）\n"
                        "- 同时提供自然的中文翻译\n"
                        "- 把英文句子按意群切分为 chunks（3-6 段，每段 2-6 词，逗号/连接词/介词短语处切分）\n"
                        "- 每块标注语法角色 role：subject（主语+修饰）/ predicate（谓语+宾语）/ adverbial（时间地点状语）\n"
                        '严格输出 JSON: {"example": "英文句子", "example_cn": "中文翻译", "chunks": [{"text": "意群", "role": "subject|predicate|adverbial"}...]}'
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
            chunks = data.get("chunks") or []
            if not isinstance(chunks, list):
                chunks = []
            # 兼容两种格式：字符串数组 或 {text, role} 对象数组
            chunks = [
                ch if isinstance(ch, dict) else {"text": ch, "role": None}
                for ch in chunks
            ]
            if example:
                sentence_card = Card(
                    word=card.word,
                    phonetic=card.phonetic,
                    meaning=example_cn,
                    example=example,
                    example_cn=example_cn,
                    kind="sentence",
                    chunks=chunks or None,
                    difficulty="reading",
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
