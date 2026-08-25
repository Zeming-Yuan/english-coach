import json

from openai import OpenAI
from sqlalchemy.orm import Session

from app.config import settings
from app.models.card import Card
from app.services.model_router import Task, route

client = OpenAI(api_key=settings.deepseek_api_key, base_url=settings.deepseek_base_url)

SYSTEM_PROMPT = (
    "你是零基础英语老师。为每个单词生成学习卡片，包含以下字段：\n"
    "1. phonetic: 音标\n"
    "2. meaning: 中文释义（简洁）\n"
    "3. example: 一个完整英文例句（必须有具体场景、人物或动作，至少 8 个单词。"
    "禁止 'This is X' / 'I have X' / 'I like X' 式空泛句。"
    "好例子：'The fat cat sat on my laptop while I was studying!'\n"
    "4. example_cn: 例句的自然中文翻译\n"
    "5. explanation: 讲解（必须包含三要素，用 | 分隔）："
    "用法要点 | 常见搭配 | 易错提醒。"
    "例：'可数名词，复数加s | a cat / cats / kitten(小猫) | 不要写成 catt'\n"
    "6. contexts: 2–3 条对话体语境例句（两人简短对话，目标词必须出现，用词简单），中英成对。\n"
    "7. related_words: 词族/近义词数组（2-4个），每个元素含 word 和 meaning。"
    "例：[{\"word\": \"kitten\", \"meaning\": \"小猫\"}, {\"word\": \"pet\", \"meaning\": \"宠物\"}]。"
    "优先选同词族（如 teach→teacher）和常用近义词，用词简单零基础可懂。\n"
    "【记忆科学要求】例句和语境必须具体、有画面感：有真实场景和情绪，"
    "越具体越容易记住。尽量有动作、地点、情绪、意外感。\n"
    '严格输出 JSON: {"cards": [{"word":..., "phonetic":..., "meaning":...,'
    '"example":..., "example_cn":..., "explanation":...,'
    '"contexts": [{"en": ..., "cn": ...}, ...],'
    '"related_words": [{"word":..., "meaning":...}, ...]}]}'
)


def regenerate_example(word: str) -> tuple[str, str, str]:
    """为已有单词重新生成例句/翻译/讲解（换一个按钮，轻量）。"""
    resp = client.chat.completions.create(
        model=route(Task.BULK),
        messages=[
            {
                "role": "system",
                "content": (
                    "你是零基础英语老师。为单词重新生成一个新例句和讲解。\n"
                    "【例句要求】必须是完整句子（至少 8 个单词），有具体场景、人物或动作。"
                    "禁止 'This is X' / 'I have X' / 'I like X' 式空泛句。"
                    "好例子：'The fat cat sat on my laptop while I was studying!'\n"
                    "【讲解要求】必须包含三要素，用 | 分隔：用法要点 | 常见搭配 | 易错提醒。"
                    "例：'可数名词，复数加s | a cat / cats / kitten(小猫) | 不要写成 catt'\n"
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
    for c in data.get("cards", []):
        try:
            if not isinstance(c.get("contexts"), list):
                c["contexts"] = []
            if not isinstance(c.get("related_words"), list):
                c["related_words"] = []
            if not c.get("word"):
                continue
            # 质量校验：例句太短或太简单则清空（让前端显示"换一个"按钮）
            example = c.get("example", "")
            if len(example) < 15 or example.lower().startswith(("this is ", "i have ", "i like ", "it is ")):
                c["example"] = ""
                c["example_cn"] = ""
            cards.append(Card(**c))
        except (TypeError, ValueError):
            continue  # 跳过格式错误的卡，不阻塞整批
    db.add_all(cards)
    db.commit()
    return cards
