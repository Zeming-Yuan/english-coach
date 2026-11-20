import json
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.card import Card
from app.services.llm import generate_json
from app.services.llm_client import LLMNotConfigured
from app.services.word_expansions import (
    EXPANSIONS_PROMPT,
    has_expansions,
    normalize_expansions,
)
from app.services.write_transaction import run_write

SYSTEM_PROMPT = EXPANSIONS_PROMPT + (
    "你是零基础英语老师。为每个输入条目各生成一张学习卡片。word 使用原条目，保留完整短语和内部空格。其他字段：\n"
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
    "7. related_words: 按上述词汇扩展要求生成。\n"
    "8. chunks: 把 example 按意群切分为数组（3-6 段，每段 2-6 词，逗号/连接词/介词短语处切分），"
    "每块标注角色 role（subject=主语 / predicate=谓宾 / adverbial=状语）。\n"
    "【记忆科学要求】例句和语境必须具体、有画面感：有真实场景和情绪，"
    "越具体越容易记住。尽量有动作、地点、情绪、意外感。\n"
    '严格输出 JSON: {"cards": [{"word":..., "phonetic":..., "meaning":...,'
    '"example":..., "example_cn":..., "explanation":...,'
    '"contexts": [{"en": ..., "cn": ...}, ...],'
    '"related_words": [{"kind":..., "word":..., "meaning":...}, ...],'
    '"chunks": [{"text": "意群", "role": "subject|predicate|adverbial"}...]}]}'
)

_REGENERATE_PROMPT = (
    "你是零基础英语老师。为单词重新生成一个新例句和讲解。\n"
    "【例句要求】必须是完整句子（至少 8 个单词），有具体场景、人物或动作。"
    "禁止 'This is X' / 'I have X' / 'I like X' 式空泛句。"
    "好例子：'The fat cat sat on my laptop while I was studying!'\n"
    "【讲解要求】必须包含三要素，用 | 分隔：用法要点 | 常见搭配 | 易错提醒。"
    "例：'可数名词，复数加s | a cat / cats / kitten(小猫) | 不要写成 catt'\n"
    '严格输出 JSON: {"example": "...", "example_cn": "...", "explanation": "..."}'
)


def generate_expansions(word: str, meaning: str) -> list[dict[str, str]]:
    """Generate usable typed expansions for an existing card, or fail explicitly."""
    data = generate_json(
        EXPANSIONS_PROMPT + '严格输出 JSON: {"related_words": [...]}',
        json.dumps({"word": word, "meaning": meaning}, ensure_ascii=False),
    )
    rows = normalize_expansions(
        data.get("related_words") if isinstance(data, dict) else None, word
    )
    if not has_expansions(rows):
        raise ValueError("LLM 返回的词汇扩展不可用，请重试")
    return rows


def regenerate_example(word: str) -> tuple[str, str, str]:
    """为已有单词重新生成例句/翻译/讲解（换一个按钮，轻量）。"""
    data = generate_json(_REGENERATE_PROMPT, word)
    if data is None:
        raise ValueError("LLM 失败")
    example = data.get("example")
    example_cn = data.get("example_cn")
    explanation = data.get("explanation")
    if (
        not isinstance(example, str)
        or not example.strip()
        or not isinstance(example_cn, str)
        or not example_cn.strip()
        or not isinstance(explanation, str)
        or not explanation.strip()
    ):
        raise ValueError("LLM 返回的例句、翻译或讲解不完整")
    if max(len(example), len(example_cn), len(explanation)) > 500:
        raise ValueError("LLM 返回的例句、翻译或讲解超过长度上限")
    return example, example_cn, explanation


@dataclass
class CardGeneration:
    cards: list[Card]
    existing_words: list[str]
    failed_words: list[str]
    error: ValueError | LLMNotConfigured | None = None


def _word_key(word: str) -> str:
    return word.strip().casefold()


def _existing_word_keys(db: Session, requested: dict[str, str]) -> set[str]:
    return {
        key
        for word in db.scalars(select(Card.word).where(Card.kind == "word"))
        if (key := _word_key(word)) in requested
    }


def generate_cards(words: list[str], db: Session) -> CardGeneration:
    """Generate only confirmed entries and report the outcome for each distinct word."""
    requested: dict[str, str] = {}
    for word in words:
        if key := _word_key(word):
            requested.setdefault(key, word.strip())
    existing = _existing_word_keys(db, requested)
    missing = {key: word for key, word in requested.items() if key not in existing}
    if not missing:
        return CardGeneration([], list(requested.values()), [])

    # Release the read transaction while waiting for the model.
    db.rollback()
    error = None
    try:
        candidates = _generate_new_cards(missing)
    except (ValueError, LLMNotConfigured) as exc:
        error = exc
        candidates = {}

    def finish(session: Session) -> CardGeneration:
        result = CardGeneration([], [], [], error)
        current = _existing_word_keys(session, requested)
        for key, word in requested.items():
            if key in current:
                result.existing_words.append(word)
            elif key in candidates:
                card = candidates[key]
                session.add(card)
                result.cards.append(card)
            else:
                result.failed_words.append(word)
        return result

    return run_write(db, finish) if candidates else finish(db)


def _generate_new_cards(requested: dict[str, str]) -> dict[str, Card]:
    data = generate_json(
        SYSTEM_PROMPT,
        json.dumps({"words": list(requested.values())}, ensure_ascii=False),
    )
    if data is None:
        raise ValueError("LLM 失败")
    generated = data.get("cards")
    if not isinstance(generated, list):
        raise ValueError("LLM 返回的词卡格式错误")  # noqa: TRY004 — 生成失败的公共契约
    cards: dict[str, Card] = {}
    content_fields = {
        "word",
        "phonetic",
        "meaning",
        "example",
        "example_cn",
        "explanation",
        "contexts",
        "related_words",
        "chunks",
    }
    for c in generated:
        if not isinstance(c, dict):
            continue
        if not isinstance(c.get("word"), str) or not c["word"].strip():
            continue
        word_key = _word_key(c["word"])
        if word_key not in requested or word_key in cards:
            continue
        if any(
            key in c and c[key] is not None and not isinstance(c[key], str)
            for key in ("phonetic", "meaning", "example", "example_cn", "explanation")
        ):
            continue
        try:
            c = {key: value for key, value in c.items() if key in content_fields}
            c["word"] = requested[word_key]
            if not isinstance(c.get("contexts"), list):
                c["contexts"] = []
            c["related_words"] = normalize_expansions(c.get("related_words"), c["word"])
            if isinstance(c.get("chunks"), list):
                # 兼容对象数组 [{text, role}] 或字符串数组
                c["chunks"] = [
                    ch if isinstance(ch, dict) else {"text": ch, "role": None}
                    for ch in c["chunks"]
                ]
            else:
                c["chunks"] = None
            # 质量校验：例句太短或太简单则清空（让前端显示"换一个"按钮）
            example = c.get("example") or ""
            if len(example) < 15 or example.lower().startswith(
                ("this is ", "i have ", "i like ", "it is ")
            ):
                c["example"] = ""
                c["example_cn"] = ""
                c["chunks"] = None
            cards[word_key] = Card(**c, kind="word", difficulty="basic")
        except (TypeError, ValueError):
            continue  # 跳过格式错误的卡，不阻塞整批
    return cards
