"""课程生成服务：AI 按 level 生成零基础学习单元（词表 + 对话）。

level 设计（1-20，递进）：
1-3      音标启蒙 + 超高频词（hello/yes/no/I/you...）
4-8      基础词汇（日常名词/动词）
9-14     简单句（主谓宾短句 + 常用句型）
15-20    初级对话（场景：点餐/问路/自我介绍...）

词复用 cards 表：生成的词带完整字段（word/phonetic/meaning/example/explanation）
直接入库，学完自然进今日队列走 FSRS。对话存 lesson.content 供前端学习。
"""

from datetime import UTC
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.card import Card
from app.models.lesson import Lesson
from app.models.lesson_progress import LessonProgress
from app.runtime import Runtime
from app.services.llm import generate_json
from app.services.write_transaction import run_write

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


MAX_LEVEL = 20


class LessonLevelConflictError(RuntimeError):
    """目标级别已存在或并发生成冲突；不得跳级或留下半课。"""


class LessonCapReachedError(RuntimeError):
    """二十课已全部生成。"""


def lesson_goal(level: int) -> str:
    """用户可理解的本课目标；旧课也用同一版本化主题说明。"""
    return LEVEL_DESCRIPTIONS.get(level, "日常场景词汇")


def _text(value, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"课程内容不合法：{field}不能为空")
    return value.strip()


def validate_lesson(data) -> dict:
    """校验生成结构：唯一词形、释义、例句/翻译与对话中英配对。"""
    if not isinstance(data, dict):
        raise TypeError("课程内容不合法：必须是对象")
    title = _text(data.get("title"), "标题")
    words = data.get("words")
    if not isinstance(words, list) or not 1 <= len(words) <= 10:
        raise ValueError("课程内容不合法：单词数量必须为 1-10 个")
    seen_words = set()
    clean_words = []
    for index, word in enumerate(words, 1):
        if not isinstance(word, dict):
            raise TypeError(f"课程内容不合法：第 {index} 个单词必须是对象")
        form = _text(word.get("word"), f"第 {index} 个单词的词形")
        key = form.casefold()
        if key in seen_words:
            raise ValueError(f"课程内容不合法：单词重复：{form}")
        seen_words.add(key)
        phonetic = word.get("phonetic")
        if phonetic is not None and not isinstance(phonetic, str):
            raise ValueError(f"课程内容不合法：{form} 的音标必须是文本")
        clean_words.append(
            {
                "word": form,
                "phonetic": (phonetic or "").strip(),
                "meaning": _text(word.get("meaning"), f"{form} 的释义"),
                "example": _text(word.get("example"), f"{form} 的例句"),
                "example_cn": _text(word.get("example_cn"), f"{form} 的例句翻译"),
            }
        )
    dialogue = data.get("dialogue")
    if not isinstance(dialogue, list) or not 1 <= len(dialogue) <= 10:
        raise ValueError("课程内容不合法：对话数量必须为 1-10 句")
    clean_dialogue = []
    for index, line in enumerate(dialogue, 1):
        if not isinstance(line, dict):
            raise TypeError(f"课程内容不合法：第 {index} 句对话必须是对象")
        clean_dialogue.append(
            {
                "speaker": _text(line.get("speaker"), f"第 {index} 句的说话人"),
                "en": _text(line.get("en"), f"第 {index} 句英文"),
                "cn": _text(line.get("cn"), f"第 {index} 句中文"),
            }
        )
    tips = data.get("tips") or []
    if not isinstance(tips, list) or not all(isinstance(tip, str) for tip in tips):
        raise ValueError("课程内容不合法：提示必须是文本数组")
    return {
        "title": title,
        "words": clean_words,
        "dialogue": clean_dialogue,
        "tips": [tip.strip() for tip in tips if tip.strip()],
    }


def _level_prompt(level: int) -> str:
    desc = LEVEL_DESCRIPTIONS.get(level, "日常场景词汇")
    return (
        f"你是零基础英语老师。这是第 {level} 课，主题：{desc}。"
        "请生成 5 个单词和一段简短对话（3-5 句）。"
        "单词用词简单，配音标、中文释义、一个简单例句及翻译。"
        "【记忆科学要求】例句和对话要具体、有画面感：有真实场景和情绪，"
        "避免 I like xxx / This is xxx 式空泛句；对话尽量像真实生活里会说的，"
        "可以有小意外、小笑点、上下文。"
        "对话围绕主题，每句给说话人（A/B）和中英对照。"
        '严格输出 JSON: {"title": "...", "words": [{"word":..., "phonetic":..., '
        '"meaning":..., "example":..., "example_cn":...}], '
        '"dialogue": [{"speaker": "A", "en": "...", "cn": "..."}], '
        '"tips": ["..."]}'
    )


def generate_next_lesson(db: Session, *, operation_id=None, runtime: Runtime) -> Lesson:
    """确定下一课并在写锁内复核；路由不先读库再进入写模块。"""
    if operation_id is not None:
        existing = (
            db.execute(
                select(LessonProgress).where(
                    LessonProgress.generation_id == str(operation_id)
                )
            )
            .scalars()
            .first()
        )
        if existing is not None:
            lesson = db.get(Lesson, existing.lesson_id)
            if lesson is None:
                raise ValueError("课程内容不合法：生成记录缺少课程")
            return lesson
    max_level = db.scalar(select(func.max(Lesson.level))) or 0
    if max_level >= MAX_LEVEL:
        raise LessonCapReachedError("全部课程已生成")
    return generate_lesson(
        db, max_level + 1, operation_id=operation_id, runtime=runtime
    )


def generate_lesson(
    db: Session, level: int, *, operation_id=None, runtime: Runtime
) -> Lesson:
    """校验后原子保存课程、词卡与生成状态；失败不留下半课或跳级。"""
    data = generate_json(_level_prompt(level))
    if data is None:
        raise ValueError("LLM 失败")
    content = validate_lesson(data)
    now = runtime.clock.now().astimezone(UTC).replace(tzinfo=None)

    def operation(session: Session) -> Lesson:
        if operation_id is not None:
            existing = (
                session.execute(
                    select(LessonProgress).where(
                        LessonProgress.generation_id == str(operation_id)
                    )
                )
                .scalars()
                .first()
            )
            if existing is not None:
                lesson = session.get(Lesson, existing.lesson_id)
                if lesson is None:
                    raise ValueError("课程内容不合法：生成记录缺少课程")
                return lesson
        max_level = session.scalar(select(func.max(Lesson.level))) or 0
        if max_level >= level:
            raise LessonLevelConflictError(f"第 {level} 课已存在，请重新加载")
        words = content["words"]
        existing_words = {
            name.casefold(): name
            for name in session.scalars(
                select(Card.word).where(
                    Card.kind == "word",
                    func.lower(Card.word).in_([word["word"].lower() for word in words]),
                )
            )
        }
        for word in words:
            if word["word"].casefold() in existing_words:
                word["word"] = existing_words[word["word"].casefold()]
                continue
            session.add(
                Card(
                    word=word["word"],
                    phonetic=word.get("phonetic") or None,
                    meaning=word["meaning"],
                    example=word["example"],
                    example_cn=word["example_cn"],
                    kind="word",
                )
            )
        lesson = Lesson(level=level, title=content["title"], content=content)
        session.add(lesson)
        session.flush()
        session.add(
            LessonProgress(
                lesson_id=lesson.id,
                generation_id=str(operation_id or uuid4()),
                generated=True,
                generated_at=now,
            )
        )
        session.flush()
        return lesson

    return run_write(db, operation)
