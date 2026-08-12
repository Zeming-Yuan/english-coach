import types

from app.services import card_generator


def fake_create(**kwargs):
    """伪造 DeepSeek 返回：普通对象链 choices[0].message.content"""
    return types.SimpleNamespace(
        choices=[
            types.SimpleNamespace(
                message=types.SimpleNamespace(
                    content='{"cards":[{"word":"test","phonetic":"tɛst","meaning":"测试","example":"This is a test.","example_cn":"这是一个测试。","explanation":"用于检查或评估的过程。","contexts":[{"en":"A: Is this a test? B: Yes, it is.","cn":"A：这是一个测试吗？ B：是的。"}]}]}'
                )
            )
        ]
    )


def test_generate_cards_with_contexts(db_session, monkeypatch):
    monkeypatch.setattr(card_generator.client.chat.completions, "create", fake_create)
    cards = card_generator.generate_cards(["test"], db_session)
    assert cards[0].contexts == [
        {
            "en": "A: Is this a test? B: Yes, it is.",
            "cn": "A：这是一个测试吗？ B：是的。",
        }
    ]


def test_generate_cards_with_empty_contexts(db_session, monkeypatch):
    def fake_create(**kwargs):
        return types.SimpleNamespace(
            choices=[
                types.SimpleNamespace(
                    message=types.SimpleNamespace(
                        content='{"cards":[{"word":"test","phonetic":"tɛst","meaning":"测试","example":"This is a test.","example_cn":"这是一个测试。","explanation":"用于检查或评估的过程。"}]}'
                    )
                )
            ]
        )

    monkeypatch.setattr(card_generator.client.chat.completions, "create", fake_create)
    cards = card_generator.generate_cards(["test"], db_session)
    assert cards[0].contexts == []


def test_prompt_requires_contexts(db_session, monkeypatch):
    captured = {}

    def fake(**kwargs):
        captured["system"] = kwargs["messages"][0]["content"]
        return fake_create(**kwargs)

    monkeypatch.setattr(card_generator.client.chat.completions, "create", fake)
    card_generator.generate_cards(["test"], db_session)
    assert "对话体" in captured["system"]
