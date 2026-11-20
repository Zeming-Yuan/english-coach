"""New cards from starter material and lessons retain word expansions."""

from copy import deepcopy
from unittest.mock import patch

import pytest
from sqlalchemy import select

from app.models.card import Card
from tests.test_lessons import MOCK_LESSON_DATA


def test_starter_cards_include_curated_expansions_without_ai(ec):
    response = ec.client.post("/api/cards/starter")
    assert response.status_code == 200
    cards = response.json()["cards"]
    for card in cards:
        assert card["related_words"]
        assert any(
            row.get("kind") in {"family", "affix", "compound", "synonym", "lookalike"}
            and row.get("word")
            and row.get("meaning")
            for row in card["related_words"]
        )
    apple = next(card for card in cards if card["word"] == "apple")
    assert {"kind": "compound", "word": "applesauce", "meaning": "苹果酱"} in apple[
        "related_words"
    ]
    assert {"kind": "lookalike", "word": "apply", "meaning": "申请；应用"} in apple[
        "related_words"
    ]
    assert {"kind": "lookalike", "word": "applet", "meaning": "小程序"} in apple[
        "related_words"
    ]
    teacher = next(card for card in cards if card["word"] == "teacher")
    assert {"kind": "formation", "text": "teach（教） + -er（做某事的人）"} in teacher[
        "related_words"
    ]
    assert (
        ec.client.get(f"/api/cards/{teacher['id']}").json()["related_words"]
        == teacher["related_words"]
    )


@pytest.mark.parametrize(
    ("supplied", "expected"),
    [
        (
            [{"kind": "synonym", "word": "hi", "meaning": "嗨"}],
            [{"kind": "synonym", "word": "hi", "meaning": "嗨"}],
        ),
        ([{"word": "hi", "meaning": "嗨"}], [{"word": "hi", "meaning": "嗨"}]),
        ([{"kind": "invalid", "word": "hi", "meaning": "嗨"}, None], []),
        (None, []),
        ([{"kind": "synonym", "word": "hello", "meaning": "你好"}], []),
    ],
)
def test_lesson_new_cards_retain_valid_expansions_only(
    client, db_session, supplied, expected
):
    payload = deepcopy(MOCK_LESSON_DATA)
    payload["words"][0]["related_words"] = supplied
    with patch(
        "app.services.lesson_generator.generate_json", return_value=payload
    ) as generate:
        response = client.post("/api/lessons/next")
    assert response.status_code == 200
    card = db_session.scalar(
        select(Card).where(Card.word == "hello", Card.kind == "word")
    )
    assert card.related_words == expected
    # Lesson snapshots keep their existing schema; expansions belong to cards.
    assert "related_words" not in response.json()["content"]["words"][0]
    assert generate.call_count == 1
    assert "related_words" in generate.call_args.args[0]


def test_lesson_does_not_overwrite_existing_word_expansions(client, db_session):
    original = [{"kind": "synonym", "word": "greetings", "meaning": "问候"}]
    card = Card(word="hello", kind="word", meaning="原有内容", related_words=original)
    db_session.add(card)
    db_session.commit()
    payload = deepcopy(MOCK_LESSON_DATA)
    payload["words"][0]["related_words"] = [
        {"kind": "synonym", "word": "hi", "meaning": "嗨"}
    ]
    with patch("app.services.lesson_generator.generate_json", return_value=payload):
        assert client.post("/api/lessons/next").status_code == 200
    db_session.refresh(card)
    assert card.related_words == original
    assert card.meaning == "原有内容"


@pytest.mark.parametrize("word,meaning", [("APPLE", "苹果"), (" apple ", " 苹果 ")])
def test_starter_expansions_matches_exact_starter_sense(word, meaning):
    from app.services import starter_cards

    rows = starter_cards.starter_expansions(word, meaning)
    assert rows is not None
    assert {"kind": "lookalike", "word": "apply", "meaning": "申请；应用"} in rows
    assert {"kind": "compound", "word": "applesauce", "meaning": "苹果酱"} in rows


@pytest.mark.parametrize("word,meaning", [("apple", "苹果公司"), ("pear", "梨")])
def test_starter_expansions_does_not_guess_unmatched_senses(word, meaning):
    from app.services import starter_cards

    assert starter_cards.starter_expansions(word, meaning) is None
