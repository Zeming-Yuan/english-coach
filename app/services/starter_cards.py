"""入门词卡：随应用分发的固定内容，只在用户显式添加时写入。

内容逐条核对（音标统一英式、中文释义、完整例句及对应中文），
不由 AI 生成；kind 与 difficulty 由系统控制，不接受内容文件覆盖。
"""

import json
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.card import Card

DATA_FILE = Path(__file__).resolve().parents[1] / "data" / "starter_cards.json"


def starter_card_rows() -> list[dict]:
    """读取固定入门内容（只含 word/phonetic/meaning/example/example_cn）。"""
    return json.loads(DATA_FILE.read_text(encoding="utf-8"))


def load_starter_cards(db: Session, rows: list[dict] | None = None) -> list[Card]:
    """只添加尚不存在的词卡，返回本次新增；已存在内容保持原样，不写回任何字段。"""
    added: list[Card] = []
    for row in rows if rows is not None else starter_card_rows():
        existing = db.scalar(
            select(Card).where(Card.word == row["word"], Card.kind == "word")
        )
        if existing is not None:
            continue
        card = Card(**row, kind="word", difficulty="basic")
        db.add(card)
        added.append(card)
    return added
