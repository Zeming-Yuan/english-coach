"""毕业服务测试（句子卡家族：毕业判定/兜底句卡/升级入口）。"""

from app.models.card import Card
from app.models.review import Review
from app.services.graduation import ensure_sentence_card, is_graduated


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


def test_none_not_graduated(db_session):
    """无复习记录 → 未毕业（全库唯一口径，None 一律 False）。"""
    assert is_graduated(None) is False


def test_graduate_creates_sentence_card(db_session):
    """毕业生成句子卡（用词卡例句兜底）。"""
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
    sentence = ensure_sentence_card(card, db_session)
    assert sentence is not None
    assert sentence.kind == "sentence"
    assert sentence.word == "hello"
    assert sentence.example
    assert sentence.meaning


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
    ensure_sentence_card(card, db_session)
    second = ensure_sentence_card(card, db_session)
    assert second is None


def test_graduate_no_example(db_session):
    """没有例句 → 无兜底可建，返回 None（由后台 AI 生成）。"""
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
    result = ensure_sentence_card(card, db_session)
    assert result is None
