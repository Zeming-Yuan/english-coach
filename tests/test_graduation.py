"""毕业服务测试。"""

from app.models.card import Card
from app.models.review import Review
from app.services.graduation import graduate_to_sentence, is_graduated


def test_graduated_by_state(db_session):
    """FSRS state == 2 (Review) → 毕业。"""
    review = Review(
        card_id=1,
        state=2,
        review_count=1,
        due="2026-01-01",
        stability=1.0,
        difficulty=1.0,
        elapsed_days=0,
    )
    assert is_graduated(review) is True


def test_graduated_by_count(db_session):
    """review_count >= 3 → 毕业。"""
    review = Review(
        card_id=1,
        state=1,
        review_count=3,
        due="2026-01-01",
        stability=1.0,
        difficulty=1.0,
        elapsed_days=0,
    )
    assert is_graduated(review) is True


def test_not_graduated(db_session):
    """state=1, count=2 → 未毕业。"""
    review = Review(
        card_id=1,
        state=1,
        review_count=2,
        due="2026-01-01",
        stability=1.0,
        difficulty=1.0,
        elapsed_days=0,
    )
    assert is_graduated(review) is False


def test_graduate_creates_sentence_card(db_session):
    """毕业生成句子卡，meaning 填 example_cn。"""
    card = Card(
        word="hello",
        phonetic="/həˈloʊ/",
        meaning="你好",
        example="Hello, how are you?",
        example_cn="你好，怎么样？",
        kind="word",
    )
    db_session.add(card)
    db_session.commit()
    db_session.refresh(card)
    sentence = graduate_to_sentence(card, db_session)
    assert sentence is not None
    assert sentence.kind == "sentence"
    assert sentence.meaning == "你好，怎么样？"
    assert sentence.example == "Hello, how are you?"


def test_graduate_no_duplicate(db_session):
    """已有句子卡 → 不重复生成。"""
    card = Card(
        word="hello",
        phonetic="/həˈloʊ/",
        meaning="你好",
        example="Hello, how are you?",
        example_cn="你好，怎么样？",
        kind="word",
    )
    db_session.add(card)
    db_session.commit()
    db_session.refresh(card)
    graduate_to_sentence(card, db_session)
    second = graduate_to_sentence(card, db_session)
    assert second is None


def test_graduate_no_example(db_session):
    """没有例句 → 不生成句子卡。"""
    card = Card(
        word="hello",
        phonetic="/həˈloʊ/",
        meaning="你好",
        example=None,
        example_cn=None,
        kind="word",
    )
    db_session.add(card)
    db_session.commit()
    db_session.refresh(card)
    assert graduate_to_sentence(card, db_session) is None
