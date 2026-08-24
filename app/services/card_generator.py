import json

from openai import OpenAI
from sqlalchemy.orm import Session

from app.config import settings
from app.models.card import Card
from app.services.model_router import Task, route

client = OpenAI(api_key=settings.deepseek_api_key, base_url=settings.deepseek_base_url)

SYSTEM_PROMPT = (
    "你是零基础英语老师。为每个单词生成：音标、中文释义、一个简单例句及翻译、"
    "给零基础学生的讲解（一句话，讲用法或记忆点），以及 2–3 条对话体语境例句"
    "（两人简短对话，目标词必须出现在对话中，用词简单零基础可懂），语境例句中英成对。"
    "例句用词必须简单。"
    "【记忆科学要求】例句和语境必须是具体、画面感强的（可想象出场景/画面），"
    "避免'I like apple.'这类空泛句。好例子：'The fat cat sat on my laptop while I was studying!'"
    "尽量有动作、地点、情绪、意外感，越具体越容易记住。"
    '严格输出 JSON: {"cards": [{"word":..., "phonetic":..., "meaning":...,'
    '"example":..., "example_cn":..., "explanation":...,'
    '"contexts": [{"en": ..., "cn": ...}, ...]}]}'
)


def regenerate_example(word: str) -> tuple[str, str, str]:
    """为已有单词重新生成例句/翻译/讲解（换一个按钮，轻量）。"""
    resp = client.chat.completions.create(
        model=route(Task.BULK),
        messages=[
            {
                "role": "system",
                "content": (
                    "你是零基础英语老师。为单词重新生成一个新例句：具体、有画面感、"
                    "用词简单，避免和常见例句重复。"
                    '严格输出 JSON: {"example": "...", "example_cn": "...", "explanation": "..."}'
                ),
            },
            {"role": "user", "content": word},
        ],
        response_format={"type": "json_object"},
    )
    content = resp.choices[0].message.content
    if not content:
        raise ValueError("DeepSeek 返回空内容")
    data = json.loads(content)
    return (
        data.get("example", ""),
        data.get("example_cn", ""),
        data.get("explanation", ""),
    )


def generate_cards(words: list[str], db: Session) -> list[Card]:
    """批量生成词卡：调 DeepSeek → 解析 JSON → 入库（已存在的单词跳过）。"""
    existing = {w for (w,) in db.query(Card.word).filter(Card.word.in_(words)).all()}
    new_words = [w for w in words if w not in existing]
    if not new_words:
        return []  # 全部已存在：不调 API，白烧钱（教学点 12）
    resp = client.chat.completions.create(
        model=route(Task.BULK),
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
    cards = []
    data = json.loads(content)
    for c in data["cards"]:
        if not isinstance(c.get("contexts"), list):
            c["contexts"] = []
        cards.append(Card(**c))
    db.add_all(cards)
    db.commit()
    return cards
