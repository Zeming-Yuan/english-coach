"""Public authentication boundary: exercise real sessions and isolated backends."""

import hashlib
import importlib
import json

import httpx
import pytest
from fastapi import Request
from fastapi.testclient import TestClient

ORIGIN = "https://testserver"
PASSWORD = "trial-password"
HASH = (
    "pbkdf2_sha256$600000$00112233445566778899aabbccddeeff$"
    + hashlib.pbkdf2_hmac(
        "sha256",
        PASSWORD.encode(),
        bytes.fromhex("00112233445566778899aabbccddeeff"),
        600000,
    ).hex()
)


def setup_gateway(tmp_path, ec_factory, clock=None):
    try:
        module = importlib.import_module("app.gateway")
    except ModuleNotFoundError:
        pytest.fail("The public session gateway is not implemented yet")
    environments = {8001: ec_factory(), 8002: ec_factory()}
    for env in environments.values():

        @env.app.api_route("/api/gateway-echo", methods=["GET", "POST"])
        async def echo(request: Request):
            return dict(request.headers)

    class Backends(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request):
            assert request.url.port is not None
            return await httpx.ASGITransport(
                app=environments[request.url.port].app, client=("127.0.0.1", 4321)
            ).handle_async_request(request)

    config = tmp_path / "gateway.json"
    config.write_text(
        json.dumps(
            {
                "origin": ORIGIN,
                "accounts": {
                    "owner": {
                        "password_hash": HASH,
                        "backend_url": "http://127.0.0.1:8001",
                    },
                    "friend1": {
                        "password_hash": HASH,
                        "backend_url": "http://127.0.0.1:8002",
                    },
                },
            }
        )
    )
    static = tmp_path / "static"
    static.mkdir(exist_ok=True)
    (static / "index.html").write_text('<div id="root">EnglishCoach</div>')
    (static / "test.js").write_text('console.log("public asset")')
    kwargs = {
        "config_path": config,
        "static_dir": static,
        "session_db": tmp_path / "sessions.db",
        "transport": Backends(),
    }
    if clock:
        kwargs["clock"] = clock
    return module, kwargs, environments


def login(client, username="owner"):
    return client.post(
        "/auth/login",
        json={"username": username, "password": PASSWORD},
        headers={"Origin": ORIGIN},
    )


def test_public_login_shell_and_api_rejection(tmp_path, ec_factory):
    module, kwargs, _ = setup_gateway(tmp_path, ec_factory)
    with TestClient(module.create_gateway(**kwargs), base_url=ORIGIN) as client:
        assert client.get("/").status_code == 200
        assert client.get("/static/test.js").status_code == 200
        assert client.get("/auth/session").json() == {"enabled": True, "username": None}
        response = client.get(
            "/api/stats",
            headers={
                "X-Forwarded-User": "owner",
                "Authorization": "Basic dGVzdDp0ZXN0",
            },
        )
        assert response.status_code == 401
        assert "www-authenticate" not in response.headers
        assert response.headers["cache-control"] == "no-store"


def test_login_cookie_session_persistence_and_logout_revocation(tmp_path, ec_factory):
    module, kwargs, _ = setup_gateway(tmp_path, ec_factory)
    app = module.create_gateway(**kwargs)
    with TestClient(app, base_url=ORIGIN) as client:
        bad = client.post(
            "/auth/login",
            json={"username": "owner", "password": "wrong"},
            headers={"Origin": ORIGIN},
        )
        assert bad.status_code == 401 and PASSWORD not in bad.text
        response = login(client)
        assert response.status_code == 200
        cookie = response.headers["set-cookie"]
        assert (
            "Secure" in cookie
            and "HttpOnly" in cookie
            and "SameSite=strict" in cookie
            and "Path=/" in cookie
        )
        assert "Domain=" not in cookie
        token = client.cookies.get("__Host-ec_session")
        assert token is not None
        assert client.get("/auth/session").json()["username"] == "owner"
        assert token.encode() not in kwargs["session_db"].read_bytes()
    with TestClient(module.create_gateway(**kwargs), base_url=ORIGIN) as client:
        client.cookies.set("__Host-ec_session", token)
        assert client.get("/api/stats").status_code == 200
        assert (
            client.post("/auth/logout", headers={"Origin": ORIGIN}).status_code == 200
        )
        client.cookies.set("__Host-ec_session", token)
        assert client.get("/api/stats").status_code == 401


def test_api_identity_and_ai_settings_are_account_scoped(tmp_path, ec_factory):
    module, kwargs, environments = setup_gateway(tmp_path, ec_factory)
    with (
        TestClient(module.create_gateway(**kwargs), base_url=ORIGIN) as first,
        TestClient(module.create_gateway(**kwargs), base_url=ORIGIN) as second,
    ):
        assert login(first).status_code == 200
        assert login(second, "friend1").status_code == 200
        headers = {
            "Origin": ORIGIN,
            "X-EC-Account": "owner",
            "Forwarded": "for=evil",
            "X-Forwarded-User": "friend1",
            "X-Real-IP": "evil",
        }
        assert first.post("/api/cards/starter", headers=headers).status_code == 200
        assert first.get("/api/stats").json()["total_cards"] == 10
        assert second.get("/api/stats").json()["total_cards"] == 0
        wrong = second.post("/api/cards/starter", headers=headers)
        assert wrong.status_code == 401
        assert second.get("/api/stats").json()["total_cards"] == 0
        ai = {
            "base_url": "http://127.0.0.1:9/v1",
            "model": "owner-model",
            "api_key": "owner-secret",
        }
        assert first.put("/api/ai-config", headers=headers, json=ai).status_code == 200
        view = first.get("/api/ai-config").json()
        assert (
            view["model"] == "owner-model" and view["has_key"] and "api_key" not in view
        )
        assert second.get("/api/ai-config").json()["has_key"] is False
        assert environments[8001].settings.llm_model == "owner-model"
        forwarded = first.get("/api/gateway-echo", headers=headers).json()
        assert not any(
            key == "cookie"
            or key == "authorization"
            or key == "forwarded"
            or key == "x-real-ip"
            or key.startswith("x-forwarded-")
            for key in forwarded
        )
        exported = first.get("/api/export/backup")
        assert exported.status_code == 200 and "owner-secret" not in exported.text


def test_csrf_and_stale_identity_reject_before_writing(tmp_path, ec_factory):
    module, kwargs, _ = setup_gateway(tmp_path, ec_factory)
    with TestClient(module.create_gateway(**kwargs), base_url=ORIGIN) as client:
        assert (
            client.post(
                "/auth/login",
                json={"username": "owner", "password": PASSWORD},
                headers={"Origin": "https://evil.example"},
            ).status_code
            == 403
        )
        assert login(client).status_code == 200
        for headers in (
            {},
            {"Origin": "null"},
            {"Origin": "https://evil.example"},
            {"Origin": ORIGIN},
        ):
            assert client.post("/api/cards/starter", headers=headers).status_code in (
                401,
                403,
            )
        assert client.get("/api/stats").json()["total_cards"] == 0
        assert (
            client.post(
                "/auth/logout", headers={"Origin": "https://evil.example"}
            ).status_code
            == 403
        )
        assert client.get("/auth/session").json()["username"] == "owner"


def test_expired_forged_and_replaced_sessions(tmp_path, ec_factory):
    now = [1700000000.0]
    module, kwargs, _ = setup_gateway(tmp_path, ec_factory, lambda: now[0])
    with TestClient(module.create_gateway(**kwargs), base_url=ORIGIN) as client:
        client.cookies.set("__Host-ec_session", "attacker-chosen-token")
        assert client.get("/api/stats").status_code == 401
        client.cookies.clear()
        assert login(client).status_code == 200
        first = client.cookies.get("__Host-ec_session")
        assert first is not None
        assert login(client, "friend1").status_code == 200
        second = client.cookies.get("__Host-ec_session")
        assert second is not None
        assert first != second
        client.cookies.clear()
        client.cookies.set("__Host-ec_session", first)
        assert client.get("/api/stats").status_code == 401
        client.cookies.clear()
        client.cookies.set("__Host-ec_session", second)
        now[0] += 8 * 86400
        assert client.get("/api/stats").status_code == 401


def test_login_throttle_and_safe_validation(tmp_path, ec_factory):
    module, kwargs, _ = setup_gateway(tmp_path, ec_factory)
    with TestClient(module.create_gateway(**kwargs), base_url=ORIGIN) as client:
        for _ in range(10):
            assert (
                client.post(
                    "/auth/login",
                    json={"username": "missing", "password": PASSWORD},
                    headers={"Origin": ORIGIN},
                ).status_code
                == 401
            )
        assert login(client).status_code == 429
        assert client.post(
            "/auth/login",
            content=b"x" * 5000,
            headers={"Origin": ORIGIN, "Content-Type": "application/json"},
        ).status_code in (413, 429)


@pytest.mark.parametrize(
    "backend",
    [
        "https://evil.example",
        "http://127.0.0.1:8001/evil",
        "http://user:pass@127.0.0.1:8001",
        "http://169.254.169.254:80",
    ],
)
def test_gateway_configuration_fails_closed(tmp_path, ec_factory, backend):
    module, kwargs, _ = setup_gateway(tmp_path, ec_factory)
    config = json.loads(kwargs["config_path"].read_text())
    config["accounts"]["owner"]["backend_url"] = backend
    kwargs["config_path"].write_text(json.dumps(config))
    with pytest.raises(ValueError):
        module.create_gateway(**kwargs)
