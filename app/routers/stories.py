"""故事路由。"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.card import Card
from app.models.story import Story, StoryWord
from app.services.contacts import visible_card_ids
from app.services.content_revisions import (
    advance_content_revision,
    content_revision_map,
    delete_content_revision,
    get_content_revision,
)
from app.services.llm import generate_json
from app.services.llm_client import LLMNotConfigured
from app.services.story_generator import generate_story
from app.services.write_transaction import run_write

router = APIRouter()
logger = logging.getLogger(__name__)


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
    card_revisions = content_revision_map(db, "card", [c.id for _, c in rows])
    story_revisions = content_revision_map(db, "story", story_ids)
    story_words: dict[int, list[dict]] = {}
    for sw, c in rows:
        story_words.setdefault(sw.story_id, []).append(
            {
                "id": c.id,
                "word": c.word,
                "phonetic": c.phonetic,
                "meaning": c.meaning,
                "content_revision": card_revisions[c.id],
            }
        )
    return {
        "stories": [
            {
                "id": s.id,
                "title": s.title,
                "title_cn": s.title_cn,
                "content": s.content,
                "content_cn": s.content_cn,
                "content_revision": story_revisions[s.id],
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
    # 补翻期间可能被删除或替换；重读后再序列化，删除返回 404 而不是 500。
    exists = db.scalar(select(Story.id).where(Story.id == story_id))
    if exists is None:
        raise HTTPException(status_code=404, detail="Story not found")
    return _story_to_dict(
        db.get(Story, story_id, populate_existing=True), db
    )


@router.delete("/stories/{story_id}")
def delete_story(story_id: int, db: Session = Depends(get_db)):
    """删除故事（关联表 story_words 一并删除，词卡保留）。"""
    story = db.get(Story, story_id)
    if story is None:
        raise HTTPException(status_code=404, detail="Story not found")
    db.execute(delete(StoryWord).where(StoryWord.story_id == story_id))
    delete_content_revision(db, "story", story_id)
    db.delete(story)
    db.commit()
    return {"deleted": story_id}


_TRANSLATE_PROMPT = (
    "你是专业翻译。将以下英文故事逐句翻译成中文。"
    "保持原文句子顺序，每个英文句子对应一个中文翻译。"
    "翻译要自然流畅，不要逐字硬译。"
    '严格输出 JSON: {"title_cn": "...", "sentences": [{"en": "英文.", "cn": "中文."}, ...]}'
)


def _translate_story(story: Story, db: Session) -> None:
    """为旧故事补翻中文；晚到结果不覆盖已变更或恢复后的故事。

    补翻是可选的 AI 增强：未配置、失败或内容已变化时保留原文可读，绝不阻断。
    """
    before = get_content_revision(db, "story", story.id)
    try:
        data = generate_json(
            _TRANSLATE_PROMPT, f"标题: {story.title}\n\n{story.content}"
        )
    except LLMNotConfigured:
        return
    if not data:
        return  # 翻译失败不影响阅读
    title_cn = data.get("title_cn")
    sentences = data.get("sentences", [])
    content_cn = "\n".join(s.get("cn", "") for s in sentences) if sentences else None
    if title_cn is None and content_cn is None:
        return
    changes = {"title_cn": title_cn, "content_cn": content_cn}

    def operation(session: Session) -> None:
        if session.scalar(select(Story.id).where(Story.id == story.id)) is None:
            return  # 故事已删除：晚到翻译直接丢弃
        if get_content_revision(session, "story", story.id) != before:
            return  # 故事已改写或恢复：丢弃晚到翻译
        advance_content_revision(session, "story", story.id, changes)
        if title_cn is not None:
            story.title_cn = title_cn
        if content_cn is not None:
            story.content_cn = content_cn

    try:
        run_write(db, operation)
    except SQLAlchemyError:  # 补翻写入失败不阻断原文阅读；数据异常仍上抛
        db.rollback()
        logger.warning("story translation write failed", exc_info=True)


def _story_to_dict(story: Story, db: Session) -> dict:
    """故事 → 字典（含当前修订、关联词卡和逐行可见目标）。"""
    stmt = (
        select(Card)
        .join(StoryWord, StoryWord.card_id == Card.id)
        .where(StoryWord.story_id == story.id)
    )
    cards = db.execute(stmt).scalars().all()
    revisions = content_revision_map(db, "card", [c.id for c in cards])
    words = [
        {
            "id": c.id,
            "word": c.word,
            "phonetic": c.phonetic,
            "meaning": c.meaning,
            "content_revision": revisions[c.id],
        }
        for c in cards
    ]
    lines = [line for line in (story.content or "").split("\n") if line]
    return {
        "id": story.id,
        "title": story.title,
        "title_cn": story.title_cn,
        "content": story.content,
        "content_cn": story.content_cn,
        "content_revision": get_content_revision(db, "story", story.id),
        "words": words,
        "visible_card_ids": visible_card_ids(story.content or "", words),
        "line_card_ids": [visible_card_ids(line, words) for line in lines],
    }
