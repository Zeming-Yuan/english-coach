"""词毕业服务：判定词卡是否毕业，毕业则自动生成句子卡。"""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.card import Card
from app.models.review import Review

def is_graduated(review:Review) -> bool:
    """判定词卡是否毕业：FSRS state == 3 (Review) 或复习次数 >= 3。"""
    # State 枚举：0=New, 1=Learning, 2=Relearning, 3=Review
    return review.state == 3 or review.review_count >= 3

def graduate_to_sentence(card:Card,db:Session)-> Card|None:
    """如果词卡有例句且尚未生成过句子卡，则生成一张句子卡。"""
    if not card.example:
        return None
    # 检查是否已经有句子卡
    existing = db.execute(
        select(Card).where(Card.word == card.word,Card.kind == "sentence")
    ).scalars().first()
    if existing is not None:
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
    db.commit()
    db.refresh(sentence_card)
    return sentence_card
