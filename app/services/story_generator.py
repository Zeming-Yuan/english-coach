"""故事生成服务：从新词里挑 8 个 → DeepSeek 生成故事 → 入库。"""
import json
from openai import OpenAI
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models.card import Card
from app.models.review import Review
from app.models.story import Story, StoryWord
from app.services.model_router import Task,route

client = OpenAI(api_key=settings.deepseek_api_key,
                base_url=settings.deepseek_base_url)

SYSTEM_PROMPT = (
    "你是零基础英语老师。用以下单词编一篇简短的英语小故事（100词左右），"
    "故事要自然地用到所有目标词，用词简单，适合零基础学生阅读。"
    '严格输出 JSON: {"title": "...", "story": "...", "words": [{"word": "...","phonetic": "...", "meaning": "..."}]}'
)

def pick_new_words(db:Session,limit:int=8) -> list[Card]:
    """从新词（无复习记录）里随机挑 limit 个。"""
    stmt = (
        select(Card)
        .outerjoin(Review, Review.card_id == Card.id)
        .where(Review.id.is_(None),Card.kind == "word")
        .order_by(Card.id)
        .limit(limit)
    )
    return list(db.execute(stmt).scalars().all())

def generate_story(db:Session,word_limit:int=8)->Story:
    """生成故事：挑词 → 调 API → 入库。"""
    cards = pick_new_words(db,word_limit)
    if len(cards) < 3:
        raise ValueError(f"新词不足 ({len(cards)}) 个,至少需要 3 个。")
    words_payload = [c.word for c in cards]
    resp = client.chat.completions.create(
        model=route(Task.BULK),
        messages=[
            {"role":"system","content":SYSTEM_PROMPT},
            {"role":"user","content":json.dumps({"words":words_payload},ensure_ascii=False)}
        ],
        response_format={"type":"json_object"},
    )
    content = resp.choices[0].message.content
    if not content:
        raise ValueError("DeepSeek API 返回空内容。")
    data = json.loads(content)
    # 1. 创建故事
    story = Story(title=data["title"],content=data["story"])
    db.add(story)
    db.flush()  # 获取 story.id

    # 2. 故事里的目标词关联到已有词卡
    for card in cards:
        db.add(StoryWord(story_id=story.id,card_id=card.id))
    db.commit()
    db.refresh(story)
    return story