"""词卡生成服务测试：mock 统一的 llm.generate_json 接口（接口即测试面）。"""

import pytest

from app.services import card_generator

FULL_CARD = {
    "word": "test",
    "phonetic": "tɛst",
    "meaning": "测试",
    "example": "This is a test.",
    "example_cn": "这是一个测试。",
    "explanation": "用于检查或评估的过程。",
    "contexts": [
        {"en": "A: Is this a test? B: Yes, it is.", "cn": "A：这是一个测试吗？ B：是的。"}
    ],
}


def _fake_returning(data):
    def fake(system, user, task=None):
        return data
    return fake


def test_generate_cards_with_contexts(db_session, monkeypatch):
    monkeypatch.setattr(card_generator, "generate_json", _fake_returning({"cards": [FULL_CARD]}))
    cards = card_generator.generate_cards(["test"], db_session)
    assert cards[0].contexts == [
        {
            "en": "A: Is this a test? B: Yes, it is.",
            "cn": "A：这是一个测试吗？ B：是的。",
        }
    ]


def test_generate_cards_with_empty_contexts(db_session, monkeypatch):
    card = {**FULL_CARD}
    card.pop("contexts", None)
    monkeypatch.setattr(card_generator, "generate_json", _fake_returning({"cards": [card]}))
    cards = card_generator.generate_cards(["test"], db_session)
    assert cards[0].contexts == []


def test_prompt_requires_contexts(db_session, monkeypatch):
    captured = {}

    def fake(system, user, task=None):
        captured["system"] = system
        captured["user"] = user
        return {"cards": [FULL_CARD]}

    monkeypatch.setattr(card_generator, "generate_json", fake)
    card_generator.generate_cards(["test"], db_session)
    assert "对话体" in captured["system"]


def test_generate_cards_llm_failure_raises(db_session, monkeypatch):
    """LLM 失败（None 契约）→ 调用方报错，不在模块内吞掉。"""
    monkeypatch.setattr(card_generator, "generate_json", lambda *a, **k: None)
    with pytest.raises(ValueError):
        card_generator.generate_cards(["test"], db_session)
