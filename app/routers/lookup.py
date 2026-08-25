"""查词路由：故事阅读时点击任意英文单词查释义。"""

import json

from fastapi import APIRouter, Depends
from openai import OpenAI
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models.card import Card
from app.services.model_router import Task, route

router = APIRouter()

client = OpenAI(api_key=settings.deepseek_api_key, base_url=settings.deepseek_base_url)

# 简单内存缓存（word → {phonetic, meaning}）
_cache: dict[str, dict] = {}
_CACHE_MAX = 1000


@router.get("/lookup/{word}")
def lookup_word(word: str, db: Session = Depends(get_db)):
    """查词：先查本地词库，没有则调 AI 查。"""
    word_lower = word.lower().strip()
    if not word_lower:
        return {"word": word, "phonetic": None, "meaning": None, "found": False}

    # 缓存命中
    if word_lower in _cache:
        return {**_cache[word_lower], "word": word, "found": True}

    # 查本地词库（不区分大小写）
    card = (
        db.execute(
            select(Card).where(Card.word == word_lower, Card.kind == "word")
        )
        .scalars()
        .first()
    )
    if card:
        result = {"phonetic": card.phonetic, "meaning": card.meaning}
        if len(_cache) < _CACHE_MAX:
            _cache[word_lower] = result
        return {**result, "word": word, "found": True, "card_id": card.id}

    # 本地没有 → 调 AI 查词
    try:
        resp = client.chat.completions.create(
            model=route(Task.BULK),
            messages=[
                {
                    "role": "system",
                    "content": (
                        "你是英语词典。给出发音和中文释义，简短。"
                        '严格输出 JSON: {"phonetic": "...", "meaning": "..."}'
                    ),
                },
                {"role": "user", "content": word_lower},
            ],
            response_format={"type": "json_object"},
        )
        content = resp.choices[0].message.content
        if content:
            data = json.loads(content)
            result = {"phonetic": data.get("phonetic"), "meaning": data.get("meaning")}
            if len(_cache) < _CACHE_MAX:
                _cache[word_lower] = result
            return {**result, "word": word, "found": True}
    except Exception:
        pass

    return {"word": word, "phonetic": None, "meaning": None, "found": False}
