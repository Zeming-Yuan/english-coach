"""故事生成服务：从新词里挑 8 个 → LLM 生成故事 → 入库。"""

import json

from openai import OpenAI
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models.card import Card
from app.models.review import Review
from app.models.story import Story, StoryWord
from app.services.model_router import Task, route

client = OpenAI(api_key=settings.llm_api_key, base_url=settings.llm_base_url, timeout=30)

SYSTEM_PROMPT = (
    "你是零基础英语老师。用以下单词编一篇简短的英语小故事（100词左右），"
    "故事要自然地用到所有目标词，用词简单，适合零基础学生阅读。"
    "【记忆科学要求】故事要有画面感和情绪：具体的人物、场景、小冲突或意外，"
    "读者能像看电影一样看见故事。避免平铺直叙。多用动词和感官词（看、听、摸、尝）。"
    "【翻译要求】逐句中英对照：把故事拆成句子数组，每个元素包含英文和对应中文翻译。"
    "翻译要自然流畅，不要逐字硬译。"
    '严格输出 JSON: {"title": "...", "title_cn": "...", '
    '"sentences": [{"en": "英文句子.", "cn": "中文翻译."}, ...], '
    '"words": [{"word": "...","phonetic": "...", "meaning": "..."}]}'
)


def pick_new_words(db: Session, limit: int = 8) -> list[Card]:
    """从新词（无复习记录）里随机挑 limit 个。"""
    stmt = (
        select(Card)
        .outerjoin(Review, Review.card_id == Card.id)
        .where(Review.id.is_(None), Card.kind == "word")
        .order_by(Card.id)
        .limit(limit)
    )
    return list(db.execute(stmt).scalars().all())


def generate_story(db: Session, word_limit: int = 8) -> Story:
    """生成故事：挑词 → 调 API → 入库。"""
    cards = pick_new_words(db, word_limit)
    if len(cards) < 3:
        raise ValueError(f"新词不足 ({len(cards)}) 个,至少需要 3 个。")
    words_payload = [c.word for c in cards]
    resp = client.chat.completions.create(
        model=route(Task.BULK),
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": json.dumps({"words": words_payload}, ensure_ascii=False),
            },
        ],
        response_format={"type": "json_object"},
    )
    content = resp.choices[0].message.content
    if not content:
        raise ValueError("LLM 返回空内容。")
    data = json.loads(content)
    # 1. 创建故事：将 sentences 数组拼接为 content + content_cn
    sentences = data.get("sentences", [])
    content = "\n".join(s.get("en", "") for s in sentences)
    content_cn = "\n".join(s.get("cn", "") for s in sentences)
    story = Story(
        title=data["title"],
        content=content,
        content_cn=content_cn,
        title_cn=data.get("title_cn"),
    )
    db.add(story)
    db.flush()  # 获取 story.id

    # 2. 故事里的目标词关联到已有词卡
    for card in cards:
        db.add(StoryWord(story_id=story.id, card_id=card.id))
    db.commit()
    db.refresh(story)
    return story
