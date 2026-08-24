"""故事路由。"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.card import Card
from app.models.story import Story, StoryWord
from app.services.story_generator import generate_story

router = APIRouter()


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
    return {"stories": [_story_to_dict(s, db) for s in stories]}


@router.get("/stories/{story_id}")
def get_story(story_id: int, db: Session = Depends(get_db)):
    """读取一篇故事（含关联词）。"""
    story = db.get(Story, story_id)
    if story is None:
        raise HTTPException(status_code=404, detail="Story not found")
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
        "content": story.content,
        "words": [
            {"id": c.id, "word": c.word, "phonetic": c.phonetic, "meaning": c.meaning}
            for c in cards
        ],
    }
