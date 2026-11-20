"""Shared model instructions and conservative validation for word expansions."""

import re

EXPANSIONS_PROMPT = (
    "【词汇扩展 related_words】输出同一个 JSON 数组，最多 12 条。所有释义用简洁中文。"
    '可选一条构词拆解 {"kind":"formation","text":"un-（不） + happy（高兴的）"}。'
    "拆解只解释目标单词本身，词根/词缀必须真实可靠；没有可靠构词关系就省略，禁止编造词根。"
    '其余条目格式 {"kind":"family|affix|compound|synonym|lookalike",'
    '"word":"英文词","meaning":"中文释义"}。'
    "kind 必须是其中一个值：family=确有词源/派生关系的同词族；"
    "affix=与目标词共用同一真实前缀或后缀的词（如 unhappy 与 unfair 共用 un-）；compound=包含目标词的真实合成词；"
    "synonym=与目标词当前中文词义相近的词；lookalike=拼写相似但词义/词源不同的易混词。"
    "类别可缺省（没有合适的词就省略该类），不为凑齐类别生成内容，不重复目标词。"
    "每条只用最准确的一类，不将形近词误标为同词族，不把同类事物误标为近义词。"
    "例如 apple（苹果）与 apply（申请）是 lookalike；apple 与 application（申请/应用）"
    "不是 family，也不能把 apple 拆成 appl + e；applet（小程序）是 apple 的 lookalike。apply 与 application 才是 family。"
    "例如 teacher 对 teach 是 family，unfair 对 unhappy 是 affix，"
    "apple pie 对 apple 是 compound。只选常用、适合零基础学习的词。\n"
)

_WORD_KINDS = frozenset({"family", "affix", "compound", "synonym", "lookalike"})
_CHINESE = re.compile(r"[\u3400-\u9fff]")
_ENGLISH_WORD = re.compile(r"[A-Za-z]+(?:[ '-][A-Za-z]+)*")


def _clean(value: object, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    value = value.strip()
    return value if len(value) <= limit else ""


def normalize_expansions(rows: object, word: str | None = None) -> list[dict[str, str]]:
    """Keep usable rows; legacy rows stay untyped rather than inventing a relation.

    Validation checks structure and language, not linguistic truth. Category accuracy
    depends on the shared model instructions; spelling alone is not reliable evidence.
    """
    if not isinstance(rows, list):
        return []
    result: list[dict[str, str]] = []
    seen: set[str] = {word.strip().casefold()} if isinstance(word, str) else set()
    formation: dict[str, str] | None = None
    for row in rows:
        if not isinstance(row, dict):
            continue
        kind = _clean(row.get("kind"), 20).lower()
        if kind == "formation":
            text = _clean(row.get("text"), 300)
            if text and _CHINESE.search(text) and formation is None:
                formation = {"kind": "formation", "text": text}
            continue
        if "kind" in row and kind not in _WORD_KINDS:
            continue
        word = _clean(row.get("word"), 80)
        meaning = _clean(row.get("meaning"), 200)
        if (
            not _ENGLISH_WORD.fullmatch(word)
            or not _CHINESE.search(meaning)
            or word.casefold() in seen
            or len(result) >= 12
        ):
            continue
        entry = {"word": word, "meaning": meaning}
        if kind:
            entry = {"kind": kind, **entry}
        result.append(entry)
        seen.add(word.casefold())
    return ([formation] if formation else []) + result[: 11 if formation else 12]


def has_expansions(rows: object) -> bool:
    """Legacy pairs and formation alone still need a typed expansion backfill."""
    return any(row.get("kind") in _WORD_KINDS for row in normalize_expansions(rows))
