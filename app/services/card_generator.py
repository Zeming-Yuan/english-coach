import json

from openai import OpenAI
from sqlalchemy.orm import Session

from app.config import settings
from app.models.card import Card

client = OpenAI(api_key=settings.deepseek_api_key, base_url=settings.deepseek_base_url)

SYSTEM_PROMPT = (
    "你是零基础英语老师。为每个单词生成：音标、中文释义、一个简单例句及翻译、"
    "给零基础学生的讲解（一句话，讲用法或记忆点）。例句用词必须简单。"
    '严格输出 JSON：{"cards": [{"word":..., "phonetic":..., "meaning":...,'
    '"example":..., "example_cn":..., "explanation":...}]}'
)


def generate_cards(words: list[str], db: Session) -> list[Card]:
    """批量生成词卡：调 DeepSeek → 解析 JSON → 入库（已存在的单词跳过）。"""
    existing = {w for (w,) in db.query(Card.word).filter(Card.word.in_(words)).all()}
    new_words = [w for w in words if w not in existing]
    resp = client.chat.completions.create(
        model="deepseek-v4-flash",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": json.dumps({"words": new_words}, ensure_ascii=False),
            },
        ],
        response_format={"type": "json_object"},
    )
    content = resp.choices[0].message.content
    if not content:
        raise ValueError("DeepSeek 返回空内容")
    data = json.loads(content)
    cards = [Card(**c) for c in data["cards"]]
    db.add_all(cards)
    db.commit()
    return cards
