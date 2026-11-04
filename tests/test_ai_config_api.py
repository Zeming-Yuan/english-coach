"""AI 服务配置 API：界面填写的地址/模型/密钥保存后热生效。"""

import json

import pytest

from app.config import Settings
from app.main import create_app


def test_get_reports_current_config_without_key(ec):
    resp = ec.client.get("/api/ai-config")

    assert resp.status_code == 200
    assert resp.json() == {
        "base_url": "http://127.0.0.1:9/v1",
        "model": "",
        "has_key": False,
    }


def test_put_persists_and_hot_applies(ec):
    resp = ec.client.put(
        "/api/ai-config",
        json={
            "base_url": "https://api.deepseek.com/",
            "model": "deepseek-flash",
            "api_key": "sk-test",
        },
    )

    assert resp.status_code == 200
    assert resp.json() == {
        "base_url": "https://api.deepseek.com",
        "model": "deepseek-flash",
        "has_key": True,
    }
    # 密钥只写入本机文件，接口响应不回声。
    assert "sk-test" not in resp.text
    assert ec.settings.llm_base_url == "https://api.deepseek.com"
    assert ec.settings.llm_model == "deepseek-flash"
    assert ec.settings.llm_api_key == "sk-test"
    assert ec.app.state.llm_client._settings is ec.settings
    saved = json.loads((ec.root / "llm_config.json").read_text(encoding="utf-8"))
    assert saved["api_key"] == "sk-test"


def test_put_without_key_keeps_existing(ec):
    ec.client.put(
        "/api/ai-config",
        json={"base_url": "https://a.example/v1", "model": "m1", "api_key": "sk-first"},
    )

    resp = ec.client.put(
        "/api/ai-config",
        json={"base_url": "https://a.example/v1", "model": "m2", "api_key": ""},
    )

    assert resp.status_code == 200
    assert resp.json()["has_key"] is True
    assert ec.settings.llm_model == "m2"
    assert ec.settings.llm_api_key == "sk-first"


def test_put_blank_key_allows_host_case_and_slash_variants(ec):
    ec.client.put(
        "/api/ai-config",
        json={
            "base_url": "https://api.deepseek.com",
            "model": "m1",
            "api_key": "sk-saved",
        },
    )

    resp = ec.client.put(
        "/api/ai-config",
        json={"base_url": "https://API.DeepSeek.com/", "model": "m2", "api_key": ""},
    )

    assert resp.status_code == 200
    assert ec.settings.llm_api_key == "sk-saved"


def test_put_blank_key_rejects_new_base_url(ec):
    ec.client.put(
        "/api/ai-config",
        json={
            "base_url": "https://api.deepseek.com",
            "model": "deepseek-flash",
            "api_key": "sk-saved",
        },
    )

    resp = ec.client.put(
        "/api/ai-config",
        json={
            "base_url": "https://evil.example/v1",
            "model": "deepseek-flash",
            "api_key": "",
        },
    )

    assert resp.status_code == 400
    assert resp.json()["detail"] == "更换服务地址时请重新输入 API Key"
    assert ec.settings.llm_base_url == "https://api.deepseek.com"
    saved = json.loads((ec.root / "llm_config.json").read_text(encoding="utf-8"))
    assert saved["base_url"] == "https://api.deepseek.com"


def test_saved_config_loads_on_next_app_start(ec):
    ec.client.put(
        "/api/ai-config",
        json={
            "base_url": "https://api.deepseek.com",
            "model": "deepseek-flash",
            "api_key": "sk-persist",
        },
    )

    fresh = Settings(
        _env_file=None,  # type: ignore[reportCallIssue] — BaseSettings 接受 _env_file
        database_url=ec.database_url,
        llm_api_key="",
        llm_config_path=str(ec.root / "llm_config.json"),
    )
    create_app(settings=fresh)

    assert fresh.llm_api_key == "sk-persist"
    assert fresh.llm_base_url == "https://api.deepseek.com"
    assert fresh.llm_model == "deepseek-flash"


@pytest.mark.parametrize(
    "payload",
    [
        {"base_url": "ftp://example.com", "model": "m"},
        {"base_url": "https://api.deepseek.com", "model": "  "},
    ],
)
def test_invalid_config_rejected(ec, payload):
    assert ec.client.put("/api/ai-config", json=payload).status_code == 422


def test_connection_uses_candidate_without_saving(ec, monkeypatch):
    seen = {}

    def probe(settings):
        seen.update(
            base_url=settings.llm_base_url,
            model=settings.llm_model,
            api_key=settings.llm_api_key,
        )

    monkeypatch.setattr("app.routers.ai_config._probe", probe)

    resp = ec.client.post(
        "/api/ai-config/test",
        json={
            "base_url": "https://example.com/v1",
            "model": "custom-model",
            "api_key": "sk-candidate",
        },
    )

    assert resp.json() == {"ok": True}
    assert seen == {
        "base_url": "https://example.com/v1",
        "model": "custom-model",
        "api_key": "sk-candidate",
    }
    # 测试连接只试不存。
    assert ec.settings.llm_model == ""
    assert not (ec.root / "llm_config.json").exists()


def test_connection_blank_key_uses_saved(ec, monkeypatch):
    ec.client.put(
        "/api/ai-config",
        json={
            "base_url": "https://api.deepseek.com",
            "model": "deepseek-flash",
            "api_key": "sk-saved",
        },
    )
    seen = {}
    monkeypatch.setattr(
        "app.routers.ai_config._probe",
        lambda settings: seen.update(api_key=settings.llm_api_key),
    )

    resp = ec.client.post(
        "/api/ai-config/test",
        json={
            "base_url": "https://api.deepseek.com",
            "model": "deepseek-flash",
            "api_key": "",
        },
    )

    assert resp.json() == {"ok": True}
    assert seen["api_key"] == "sk-saved"


def test_connection_blank_key_rejects_new_base_url(ec, monkeypatch):
    ec.client.put(
        "/api/ai-config",
        json={
            "base_url": "https://api.deepseek.com",
            "model": "deepseek-flash",
            "api_key": "sk-saved",
        },
    )
    called = []
    monkeypatch.setattr(
        "app.routers.ai_config._probe", lambda settings: called.append(settings)
    )

    resp = ec.client.post(
        "/api/ai-config/test",
        json={
            "base_url": "https://evil.example/v1",
            "model": "deepseek-flash",
            "api_key": "",
        },
    )

    assert resp.status_code == 400
    assert resp.json()["detail"] == "更换服务地址时请重新输入 API Key"
    assert called == []


def test_connection_failure_returns_reason(ec, monkeypatch):
    def probe(settings):
        raise RuntimeError("401 Invalid API Key")

    monkeypatch.setattr("app.routers.ai_config._probe", probe)

    resp = ec.client.post(
        "/api/ai-config/test",
        json={
            "base_url": "https://api.deepseek.com",
            "model": "deepseek-flash",
            "api_key": "sk-bad",
        },
    )

    assert resp.json() == {"ok": False, "error": "401 Invalid API Key"}
