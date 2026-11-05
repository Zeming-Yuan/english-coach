"""Public LLM helpers contain malformed external completion failures."""

from types import SimpleNamespace

import pytest

from app.services import llm


@pytest.mark.parametrize(
    "response",
    [
        SimpleNamespace(choices=[]),
        SimpleNamespace(),
        SimpleNamespace(choices=[SimpleNamespace(message=None)]),
        SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=["invalid"]))]
        ),
    ],
)
@pytest.mark.parametrize("helper", [llm.generate_json, llm.generate_text])
def test_malformed_completion_returns_none(monkeypatch, response, helper):
    transport = SimpleNamespace(
        chat=SimpleNamespace(
            completions=SimpleNamespace(create=lambda **kwargs: response)
        )
    )
    monkeypatch.setattr(llm, "client", transport)
    assert helper("system", "user") is None
