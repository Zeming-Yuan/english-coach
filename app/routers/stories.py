"""故事路由。"""

import json

from fastapi import APIRouter, Depends, HTTPException
from openai import OpenAI
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models.card import Card
from app.models.story import Story, StoryWord
from app.services.model_router import Task, route
from app.services.story_generator import generate_story

router = APIRouter()

client = OpenAI(api_key=settings.deepseek_api_key, base_url=settings.deepseek_base_url)


@router.post("/stories/generate")
def create_story(db: Session = Depends(get_db)):
    """生成一篇 AI 故事。"""
    try:
        story = generate_story(db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _story_to_dict(story, db)


@router.get("/stories")
def list_stories(db: Session = Depends(get_db)):
    """故事列表（按创建时间倒序）。"""
    stories = (
        db.execute(select(Story).order_by(Story.created_at.desc(), Story.id.desc()))
        .scalars()
        .all()
    )
    if not stories:
        return {"stories": []}
    # 批量加载所有 story-card 关系
    story_ids = [s.id for s in stories]
    rows = db.execute(
        select(StoryWord, Card)
        .join(Card, Card.id == StoryWord.card_id)
        .where(StoryWord.story_id.in_(story_ids))
    ).all()
    story_words: dict[int, list[dict]] = {}
    for sw, c in rows:
        story_words.setdefault(sw.story_id, []).append(
            {"id": c.id, "word": c.word, "phonetic": c.phonetic, "meaning": c.meaning}
        )
    return {
        "stories": [
            {
                "id": s.id,
                "title": s.title,
                "title_cn": s.title_cn,
                "content": s.content,
                "content_cn": s.content_cn,
                "words": story_words.get(s.id, []),
            }
            for s in stories
        ]
    }


@router.get("/stories/{story_id}")
def get_story(story_id: int, db: Session = Depends(get_db)):
    """读取一篇故事（含关联词）。旧故事无中文翻译时自动补翻。"""
    story = db.get(Story, story_id)
    if story is None:
        raise HTTPException(status_code=404, detail="Story not found")
    # 旧故事没有中文翻译 → 自动补翻
    if not story.content_cn:
        _translate_story(story, db)
    return _story_to_dict(story, db)


@router.delete("/stories/{story_id}")
def delete_story(story_id: int, db: Session = Depends(get_db)):
    """删除故事（关联表 story_words 一并删除，词卡保留）。"""
    story = db.get(Story, story_id)
    if story is None:
        raise HTTPException(status_code=404, detail="Story not found")
    db.execute(delete(StoryWord).where(StoryWord.story_id == story_id))
    db.delete(story)
    db.commit()
    return {"deleted": story_id}


def _translate_story(story: Story, db: Session) -> None:
    """为旧故事补翻中文（逐句对照，原地更新数据库）。"""
    try:
        resp = client.chat.completions.create(
            model=route(Task.BULK),
            messages=[
                {
                    "role": "system",
                    "content": (
                        "你是专业翻译。将以下英文故事逐句翻译成中文。"
                        "保持原文句子顺序，每个英文句子对应一个中文翻译。"
                        "翻译要自然流畅，不要逐字硬译。"
                        '严格输出 JSON: {"title_cn": "...", "sentences": [{"en": "英文.", "cn": "中文."}, ...]}'
                    ),
                },
                {"role": "user", "content": f"标题: {story.title}\n\n{story.content}"},
            ],
            response_format={"type": "json_object"},
        )
        content = resp.choices[0].message.content
        if content:
            data = json.loads(content)
            story.title_cn = data.get("title_cn")
            sentences = data.get("sentences", [])
            if sentences:
                story.content_cn = "\n".join(s.get("cn", "") for s in sentences)
            db.commit()
    except Exception:
        pass  # 翻译失败不影响阅读


def _story_to_dict(story: Story, db: Session) -> dict:
    """故事 → 字典（含关联词卡信息）。"""
    stmt = (
        select(Card)
        .join(StoryWord, StoryWord.card_id == Card.id)
        .where(StoryWord.story_id == story.id)
    )
    cards = db.execute(stmt).scalars().all()
    return {
        "id": story.id,
        "title": story.title,
        "title_cn": story.title_cn,
        "content": story.content,
        "content_cn": story.content_cn,
        "words": [
            {"id": c.id, "word": c.word, "phonetic": c.phonetic, "meaning": c.meaning}
            for c in cards
        ],
    }
