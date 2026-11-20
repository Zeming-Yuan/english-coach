"""Expansion normalization and shared generation behavior."""

import json

import pytest

from app.models.card import Card
from app.services import card_generator


def test_normalizes_generated_rows_and_persists_categories(db_session, monkeypatch):
    rows = [
        {"kind": " FORMATION ", "text": " un-（不） + happy（高兴的） "},
        {"kind": "family", "word": " happiness ", "meaning": " 幸福 ", "extra": 1},
        {"kind": "synonym", "word": "glad", "meaning": "高兴的"},
        {"kind": "lookalike", "word": "apply", "meaning": "申请"},
        {"word": "cheerful", "meaning": "愉快的"},
        {"kind": "family", "word": "HAPPINESS", "meaning": "幸福"},
        {"kind": "root", "word": "hap", "meaning": "虚构词根"},
        {"kind": "affix", "word": "unhappy", "meaning": "sad"},
        {"kind": "compound", "word": 42, "meaning": "坏数据"},
        {"kind": "family", "word": " ", "meaning": "空"},
        None,
    ]
    monkeypatch.setattr(
        card_generator,
        "generate_json",
        lambda *a: {
            "cards": [{"word": "happy", "meaning": "高兴的", "related_words": rows}]
        },
    )
    card_generator.generate_cards(["happy"], db_session)
    db_session.expire_all()
    assert db_session.query(Card).one().related_words == [
        {"kind": "formation", "text": "un-（不） + happy（高兴的）"},
        {"kind": "family", "word": "happiness", "meaning": "幸福"},
        {"kind": "synonym", "word": "glad", "meaning": "高兴的"},
        {"kind": "lookalike", "word": "apply", "meaning": "申请"},
        {"word": "cheerful", "meaning": "愉快的"},
    ]


def test_backfill_uses_shared_schema_and_input_meaning(monkeypatch):
    captured = {}

    def fake(system, user):
        captured.update(system=system, user=json.loads(user))
        return {
            "related_words": [
                {"kind": "affix", "word": "unhappy", "meaning": "不高兴的"},
                {"kind": "compound", "word": "happy-go-lucky", "meaning": "无忧无虑的"},
            ]
        }

    monkeypatch.setattr(card_generator, "generate_json", fake)
    assert card_generator.generate_expansions("happy", "高兴的") == [
        {"kind": "affix", "word": "unhappy", "meaning": "不高兴的"},
        {"kind": "compound", "word": "happy-go-lucky", "meaning": "无忧无虑的"},
    ]
    assert captured["user"] == {"word": "happy", "meaning": "高兴的"}
    # Both call sites must carry the semantic guardrails of the same schema.
    from app.services.word_expansions import EXPANSIONS_PROMPT

    assert EXPANSIONS_PROMPT in captured["system"]
    assert EXPANSIONS_PROMPT in card_generator.SYSTEM_PROMPT


@pytest.mark.parametrize(
    "data",
    [
        None,
        {},
        {"related_words": None},
        {"related_words": [{"word": "glad", "meaning": "高兴的"}]},
        {"related_words": [{"kind": "formation", "text": "错误"}]},
        {"related_words": [{"kind": "family", "word": "glad", "meaning": "happy"}]},
    ],
)
def test_backfill_fails_explicitly_on_unusable_response(monkeypatch, data):
    monkeypatch.setattr(card_generator, "generate_json", lambda *a: data)
    with pytest.raises(ValueError):
        card_generator.generate_expansions("happy", "高兴的")


@pytest.mark.parametrize(
    ("rows", "expected"),
    [
        (None, False),
        ([], False),
        ([{"word": "glad", "meaning": "高兴的"}], False),
        ([{"kind": "formation", "text": "un-（不） + happy（高兴的）"}], False),
        ([{"kind": "family", "word": "happiness", "meaning": "幸福"}], True),
        ([{"kind": "bogus", "word": "happiness", "meaning": "幸福"}], False),
        ([{"kind": "family", "word": [], "meaning": "幸福"}], False),
    ],
)
def test_has_expansions_requires_usable_typed_word_rows(rows, expected):
    assert card_generator.has_expansions(rows) is expected


def test_new_cards_exclude_casefolded_self_links(db_session, monkeypatch):
    monkeypatch.setattr(
        card_generator,
        "generate_json",
        lambda *a: {
            "cards": [
                {
                    "word": "happy",
                    "meaning": "高兴的",
                    "related_words": [
                        {"kind": "family", "word": "HAPPY", "meaning": "高兴的"},
                        {"kind": "family", "word": "happiness", "meaning": "幸福"},
                    ],
                }
            ]
        },
    )
    cards = card_generator.generate_cards(["happy"], db_session)
    assert cards[0].related_words == [
        {"kind": "family", "word": "happiness", "meaning": "幸福"}
    ]


def test_backfill_rejects_self_links_as_only_expansion(monkeypatch):
    monkeypatch.setattr(
        card_generator,
        "generate_json",
        lambda *a: {
            "related_words": [{"kind": "synonym", "word": "HAPPY", "meaning": "高兴的"}]
        },
    )
    with pytest.raises(ValueError):
        card_generator.generate_expansions("happy", "高兴的")
