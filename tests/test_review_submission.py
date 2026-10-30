"""复习提交域测试：直接打 submit_review 接口（接口即测试面）。

覆盖：FSRS 写回唯一性、错词追踪口径、毕业策略（兜底句卡 + 后台升级）、卡不存在。
"""

from datetime import timezone

import pytest
from sqlalchemy import select

from app.models.card import Card
from app.models.error_card import ErrorCard
from app.models.review import Review
from app.services import review_submission
from app.services.review_submission import CardNotFoundError, submit_review


def make_word_card(db, word="apple", with_example=True):
    card = Card(
        word=word,
        meaning="苹果",
        example="The red apple rolled off the table." if with_example else None,
        example_cn="红苹果滚下了桌子。" if with_example else None,
        kind="word",
    )
    db.add(card)
    db.commit()
    return card


def get_latest_review(db, card_id):
    return (
        db.execute(
            select(Review)
            .where(Review.card_id == card_id)
            .order_by(Review.id.desc())
        )
        .scalars()
        .first()
    )


def test_submit_writes_review_record(db_session):
    """首次提交：写回 review 记录（唯一写回点）。"""
    card = make_word_card(db_session)
    result = submit_review(db_session, card.id, 3)

    review = get_latest_review(db_session, card.id)
    assert review.review_count == 1
    assert review.state == 1  # Learning
    assert review.rating == 3
    assert review.last_review is not None
    # SQLite 读回 next_due 无 tz，与 fsrs 输出对齐后再比
    assert review.due.replace(tzinfo=timezone.utc) == result.next_due
    assert result.graduated is False


def test_submit_accumulates_review_count(db_session):
    """连续提交：计次数并推进 state。"""
    card = make_word_card(db_session)
    submit_review(db_session, card.id, 3)
    submit_review(db_session, card.id, 3)

    review = get_latest_review(db_session, card.id)
    assert review.review_count == 2
    assert review.state == 2  # 毕业状态（state==2 即毕业口径触发条件）


def test_submit_records_error_weight(db_session):
    """错词追踪：答错加权（rating=1），答对减权清空（rating>=3）。"""
    card = make_word_card(db_session)
    submit_review(db_session, card.id, 1)  # 忘了 → 错词加权
    row = db_session.execute(
        select(ErrorCard).where(ErrorCard.card_id == card.id)
    ).scalars().first()
    assert row.error_count == 1

    submit_review(db_session, card.id, 3)  # 记得 → 清权
    row = db_session.execute(
        select(ErrorCard).where(ErrorCard.card_id == card.id)
    ).scalars().first()
    assert row is None


def test_submit_uses_explicit_correct_flag(db_session):
    """显式 correct 覆盖 rating 口径（听写场景：score 与 rating 分离）。"""
    card = make_word_card(db_session)
    submit_review(db_session, card.id, 3, correct=False)  # 评分高但判错
    row = db_session.execute(
        select(ErrorCard).where(ErrorCard.card_id == card.id)
    ).scalars().first()
    assert row.error_count == 1  # 按判错加权


def test_submit_graduates_creates_sentence_and_kicks_upgrade(db_session, monkeypatch):
    """毕业：建兜底句卡 + 启动后台 AI 升级（幂等，二次提交不再启动）。"""
    calls = []
    monkeypatch.setattr(
        review_submission, "upgrade_sentence_card", lambda cid: calls.append(cid)
    )
    card = make_word_card(db_session, word="hello")

    results = [submit_review(db_session, card.id, 3) for _ in range(3)]
    # 毕业在第 2 或第 3 次触发
    graduated_results = [r for r in results if r.graduated]
    assert len(graduated_results) >= 1

    first_graduated = graduated_results[0]
    sentence = db_session.get(Card, first_graduated.sentence_card_id)
    assert sentence.kind == "sentence"
    assert sentence.word == "hello"
    # 每次毕业态提交都会触发升级（upgrade 自身幂等：已有 AI 句卡则跳过）
    assert len(calls) >= 1
    assert set(calls) == {card.id}


def test_submit_sentence_kind_never_graduates(db_session, monkeypatch):
    """句子卡不做毕业处理（不启动升级）。"""
    monkeypatch.setattr(review_submission, "upgrade_sentence_card", lambda cid: None)
    card = Card(
        word="hello",
        meaning="你好",
        example="Hello, how are you?",
        example_cn="你好，怎么样？",
        kind="sentence",
    )
    db_session.add(card)
    db_session.commit()

    result = submit_review(db_session, card.id, 3)
    assert result.graduated is False


def test_submit_card_not_found(db_session):
    """卡不存在 → CardNotFoundError。"""
    with pytest.raises(CardNotFoundError):
        submit_review(db_session, 999, 3)
