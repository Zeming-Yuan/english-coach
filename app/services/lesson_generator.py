"""课程生成服务：AI 按 level 生成零基础学习单元（词表 + 对话）。

level 设计（1-20，递进）：
1-3      音标启蒙 + 超高频词（hello/yes/no/I/you...）
4-8      基础词汇（日常名词/动词）
9-14     简单句（主谓宾短句 + 常用句型）
15-20    初级对话（场景：点餐/问路/自我介绍...）

词复用 cards 表：生成的词带完整字段（word/phonetic/meaning/example/explanation）
直接入库，学完自然进今日队列走 FSRS。对话存 lesson.content 供前端学习。
"""

import json

from openai import OpenAI
from sqlalchemy.orm import Session

from app.config import settings
from app.models.card import Card
from app.models.lesson import Lesson
from app.services.model_router import Task, route

client = OpenAI(api_key=settings.deepseek_api_key, base_url=settings.deepseek_base_url)

LEVEL_DESCRIPTIONS = {
    1: "最基础的问候用词和自我介绍超高频词",
    2: "常见物品和日常动作的基础词",
    3: "数字、颜色、家庭成员词",
    4: "食物和饮品相关词",
    5: "地点和交通相关词",
    6: "身体和感受相关词",
    7: "天气和时间表达词",
    8: "动词短语和日常活动词",
    9: "简单陈述句：主语+动词+宾语结构",
    10: "简单疑问句：Is/Are/Can 开头",
    11: "This/That/There is 句型",
    12: "情态动词 can/may/must 简单用法",
    13: "描述性句子：形容词修饰名词",
    14: "I like / I want / I need 常用表达",
    15: "自我介绍场景对话",
    16: "点餐场景对话",
    17: "问路场景对话",
    18: "购物场景对话",
    19: "就医场景对话",
    20: "旅行场景对话",
}


def _level_prompt(level: int) -> str:
    desc = LEVEL_DESCRIPTIONS.get(level, "日常场景词汇")
    return (
        f"你是零基础英语老师。这是第 {level} 课，主题：{desc}。"
        "请生成 5 个单词和一段简短对话（3-5 句）。"
        "单词用词简单，配音标、中文释义、一个简单例句及翻译。"
        "对话围绕主题，每句给说话人（A/B）和中英对照。"
        '严格输出 JSON: {"title": "...", "words": [{"word":..., "phonetic":..., '
        '"meaning":..., "example":..., "example_cn":...}], '
        '"dialogue": [{"speaker": "A", "en": "...", "cn": "..."}], '
        '"tips": ["..."]}'
    )


def generate_lesson(db: Session, level: int) -> Lesson:
    """生成一课并入库：
    1. 词落 cards 表（已存在的词跳过，复用学习流）
    2. lesson 内容入库（含 title/words/dialogue/tips）
    """
    resp = client.chat.completions.create(
        model=route(Task.BULK),
        messages=[
            {"role": "system", "content": _level_prompt(level)},
        ],
        response_format={"type": "json_object"},
    )
    content = resp.choices[0].message.content
    if not content:
        raise ValueError("DeepSeek 返回空内容")

    data = json.loads(content)

    # 1. 词落 cards（跳过已存在）
    words = data.get("words", [])
    existing = (
        {
            w
            for (w,) in db.query(Card.word)
            .filter(Card.word.in_([w["word"] for w in words]))
            .all()
        }
        if words
        else set()
    )
    for w in words:
        if w["word"] in existing:
            continue
        db.add(
            Card(
                word=w["word"],
                phonetic=w.get("phonetic"),
                meaning=w.get("meaning"),
                example=w.get("example"),
                example_cn=w.get("example_cn"),
                kind="word",
            )
        )
    db.commit()

    # 2. lesson 入库
    lesson = Lesson(
        level=level,
        title=data.get("title", f"第 {level} 课"),
        content=data,
    )
    db.add(lesson)
    db.commit()
    db.refresh(lesson)
    return lesson
