"""词毕业服务：判定词卡是否毕业，毕业则生成句子卡。

句子卡生成分两步（避免复习提交被 AI 调用卡住）：
1. ensure_sentence_card：同步、无 AI。用词卡例句先建句子卡（毫秒级）。
2. upgrade_sentence_card：后台线程执行。调 AI 把句子卡升级成更复杂的
   阅读例句（对话体/意群切分/难度标记），失败则保留例句卡。
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.card import Card
from app.models.review import Review
from app.services.llm import generate_json


def is_graduated(review: Review | None) -> bool:
    """判定词卡是否毕业：FSRS state == 2 (Review) 或复习次数 >= 3。

    全库唯一毕业口径（复习提交、/api/stats 毕业生数、卡片 payload、
    设置页重生成句卡都用它）。None 一律未毕业。
    """
    if review is None:
        return False
    # State 枚举（py-fsrs）：0=New, 1=Learning, 2=Review, 3=Relearning
    return review.state == 2 or review.review_count >= 3


def find_sentence_card(db: Session, word: str) -> Card | None:
    """词 → 句子卡查询（全库统一，多处调用不再各写各的）。"""
    return (
        db.execute(select(Card).where(Card.word == word, Card.kind == "sentence"))
        .scalars()
        .first()
    )


def ensure_sentence_card(card: Card, db: Session) -> Card | None:
    """同步、无 AI：用词卡例句快速生成句子卡（毫秒级）。

    与词卡例句不同，句子卡要求：
    - 更长的句子（15-25 词）
    - 更多上下文和词汇
    - 有故事感或场景感
    但满足这些要求的 AI 生成已移入 upgrade_sentence_card 后台执行，
    这里只用例句兜底，确保 /api/reviews 秒回。
    无例句时返回 None（由后台 AI 生成）。
    """
    if find_sentence_card(db, card.word) is not None:
        return None

    if not card.example or not card.example_cn:
        return None
    sentence_card = Card(
        word=card.word,
        phonetic=card.phonetic,
        meaning=card.example_cn,
        example=card.example,
        example_cn=card.example_cn,
        kind="sentence",
    )
    db.add(sentence_card)
    db.flush()
    return sentence_card


_AI_SENTENCE_PROMPT = (
    "你是零基础英语老师。为目标单词生成一个用于阅读练习的句子。\n"
    "【要求】\n"
    "- 优先用对话体（A/B 两人简短来往，有应答、有场景），如：\n"
    '  A: Look at that cloud! B: It looks like a giant rabbit.\n'
    "- 若无对话体则用叙述句，15-25 词，有画面感和故事性\n"
    "- 目标词必须出现在句中\n"
    "- 用词可以比零基础稍难一点（有 1-2 个生词没关系）\n"
    "- 同时提供自然的中文翻译\n"
    "- 把英文句子按意群切分为 chunks（3-6 段，每段 2-6 词，逗号/连接词/介词短语处切分）\n"
    "- 每块标注语法角色 role：subject（主语+修饰）/ predicate（谓语+宾语）/ adverbial（时间地点状语）\n"
    '严格输出 JSON: {"example": "英文句子", "example_cn": "中文翻译", "chunks": [{"text": "意群", "role": "subject|predicate|adverbial"}...]}'
)


def _generate_ai_sentence(word: str) -> dict | None:
    """调 AI 生成复杂句（对话体优先 + 意群切分 + 难度标记）。失败返回 None。"""
    return generate_json(_AI_SENTENCE_PROMPT, word)


def upgrade_sentence_card(card_id: int) -> None:
    """后台线程入口：为刚毕业的词卡生成 AI 复杂句卡（自建数据库会话）。

    幂等：已有 AI 句卡（带意群切分）则跳过。AI 失败时回退例句兜底。
    """
    from app.db import SessionLocal

    db = SessionLocal()
    try:
        card = db.get(Card, card_id)
        if card is None or card.kind != "word":
            return
        existing = find_sentence_card(db, card.word)
        if existing is not None and (existing.chunks or existing.difficulty == "reading"):
            return  # 已有 AI 句卡，无需升级

        data = _generate_ai_sentence(card.word)
        example = (data or {}).get("example", "")
        if data and example:
            chunks_raw = data.get("chunks") or []
            if not isinstance(chunks_raw, list):
                chunks_raw = []
            # 兼容两种格式：字符串数组 或 {text, role} 对象数组
            chunks = [
                ch if isinstance(ch, dict) else {"text": ch, "role": None}
                for ch in chunks_raw
            ]
            if existing is not None:
                # 升级轮廓句卡（保留原 id，前端已引用）
                existing.example = example
                existing.example_cn = data.get("example_cn", existing.example_cn)
                existing.meaning = data.get("example_cn", existing.meaning)
                existing.chunks = chunks or None
                existing.difficulty = "reading"
            else:
                db.add(
                    Card(
                        word=card.word,
                        phonetic=card.phonetic,
                        meaning=data.get("example_cn", ""),
                        example=example,
                        example_cn=data.get("example_cn", ""),
                        kind="sentence",
                        chunks=chunks or None,
                        difficulty="reading",
                    )
                )
        elif existing is None and card.example:
            # AI 失败且还没有轮廓句卡：用词卡例句兜底
            db.add(
                Card(
                    word=card.word,
                    phonetic=card.phonetic,
                    meaning=card.example_cn,
                    example=card.example,
                    example_cn=card.example_cn,
                    kind="sentence",
                )
            )
        db.commit()
    except Exception:  # noqa: BLE001 — 后台线程不得冒泡
        db.rollback()
    finally:
        db.close()
