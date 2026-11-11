"""Optional public session boundary for separately isolated learning instances.

Run with ``uvicorn app.gateway:gateway_from_env --factory`` behind HTTPS.
The learning application remains a loopback-only, single-user process.
"""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import os
import re
import secrets
import sqlite3
import time
from collections.abc import Callable
from contextlib import asynccontextmanager, closing
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

COOKIE = "__Host-ec_session"
SESSION_SECONDS = 7 * 86400
ITERATIONS = 600000
HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
}


def password_hash(password: str) -> str:
    """Hash an existing provisioned password; plaintext is never gateway config."""
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, ITERATIONS)
    return f"pbkdf2_sha256${ITERATIONS}${salt.hex()}${digest.hex()}"


def _password_parts(record: str) -> tuple[bytes, bytes]:
    try:
        algorithm, iterations, salt, digest = record.split("$")
        if algorithm != "pbkdf2_sha256" or int(iterations) != ITERATIONS:
            raise ValueError
        salt_bytes, digest_bytes = bytes.fromhex(salt), bytes.fromhex(digest)
        if len(salt_bytes) != 16 or len(digest_bytes) != 32:
            raise ValueError
        return salt_bytes, digest_bytes
    except (ValueError, AttributeError) as exc:
        raise ValueError("Invalid gateway password hash") from exc


def _verify(password: str, record: str) -> bool:
    salt, expected = _password_parts(record)
    actual = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, ITERATIONS)
    return hmac.compare_digest(actual, expected)


def _config(path: Path) -> tuple[str, dict]:
    payload = json.loads(path.read_text())
    origin = payload["origin"]
    parsed = urlsplit(origin)
    if (
        parsed.scheme != "https"
        or not parsed.netloc
        or parsed.path
        or parsed.query
        or parsed.fragment
        or parsed.username
        or parsed.password
    ):
        raise ValueError("Gateway requires one explicit HTTPS origin")
    accounts = payload["accounts"]
    if not isinstance(accounts, dict) or not 1 <= len(accounts) <= 16:
        raise ValueError("Gateway requires configured accounts")
    for username, account in accounts.items():
        if not re.fullmatch(r"[a-z0-9_-]{1,32}", username):
            raise ValueError("Invalid gateway account name")
        _password_parts(account["password_hash"])
        backend = urlsplit(account["backend_url"])
        if (
            backend.scheme != "http"
            or backend.path
            or backend.query
            or backend.fragment
            or backend.username
            or backend.password
            or not backend.port
            or not ipaddress.ip_address(backend.hostname).is_loopback
        ):
            raise ValueError("Gateway backends must be fixed loopback HTTP origins")
    return origin, accounts


class Sessions:
    """Persistent revocable sessions; only token digests are stored."""

    def __init__(self, path: Path, clock: Callable[[], float]):
        self.path, self.clock = path, clock
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with closing(self.connect()) as db, db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, username TEXT NOT NULL, credential TEXT NOT NULL, expires REAL NOT NULL)"
            )
            db.execute(
                "CREATE TABLE IF NOT EXISTS attempts (ip TEXT NOT NULL, stamp REAL NOT NULL)"
            )
            db.execute("CREATE INDEX IF NOT EXISTS attempts_ip ON attempts(ip, stamp)")
        path.chmod(0o600)

    def connect(self):
        return sqlite3.connect(self.path, timeout=10)

    @staticmethod
    def digest(token: str) -> str:
        return hashlib.sha256(token.encode()).hexdigest()

    def username(self, token: str, accounts: dict) -> str | None:
        if not token or len(token) > 128:
            return None
        with closing(self.connect()) as db:
            row = db.execute(
                "SELECT username,credential,expires FROM sessions WHERE token=?",
                (self.digest(token),),
            ).fetchone()
        if (
            row
            and row[2] > self.clock()
            and row[0] in accounts
            and hmac.compare_digest(
                row[1], self.digest(accounts[row[0]]["password_hash"])
            )
        ):
            return row[0]
        return None

    def revoke(self, token: str):
        with closing(self.connect()) as db, db:
            db.execute("DELETE FROM sessions WHERE token=?", (self.digest(token),))

    def create(self, username: str, record: str, previous: str) -> str:
        token = secrets.token_urlsafe(32)
        now = self.clock()
        with closing(self.connect()) as db, db:
            db.execute(
                "DELETE FROM sessions WHERE expires<=? OR token=?",
                (now, self.digest(previous)),
            )
            db.execute(
                "INSERT INTO sessions VALUES (?,?,?,?)",
                (
                    self.digest(token),
                    username,
                    self.digest(record),
                    now + SESSION_SECONDS,
                ),
            )
        return token

    def allow_login(self, ip: str) -> bool:
        now = self.clock()
        with closing(self.connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("DELETE FROM attempts WHERE stamp<=?", (now - 60,))
            count = db.execute(
                "SELECT COUNT(*) FROM attempts WHERE ip=?", (ip,)
            ).fetchone()[0]
            if count >= 10:
                return False
            db.execute("INSERT INTO attempts VALUES (?,?)", (ip, now))
        return True


def create_gateway(
    *,
    config_path: Path,
    static_dir: Path,
    session_db: Path,
    clock: Callable[[], float] = time.time,
    transport: httpx.AsyncBaseTransport | None = None,
) -> FastAPI:
    origin, accounts = _config(config_path)
    sessions = Sessions(session_db, clock)
    dummy_hash = password_hash(secrets.token_urlsafe(24))

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        async with httpx.AsyncClient(
            transport=transport,
            trust_env=False,
            timeout=httpx.Timeout(120, connect=5),
            follow_redirects=False,
        ) as client:
            app.state.upstream = client
            yield

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    def check_origin(request: Request):
        if request.headers.get("origin") != origin:
            raise HTTPException(403, "请从本站页面提交请求")

    def identity(request: Request) -> str | None:
        return sessions.username(request.cookies.get(COOKIE, ""), accounts)

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: https:; font-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
        )
        return response

    @app.get("/auth/session")
    def current_session(request: Request):
        return {"enabled": True, "username": identity(request)}

    @app.post("/auth/login")
    async def login(request: Request):
        check_origin(request)
        ip = request.client.host if request.client else "unknown"
        if not sessions.allow_login(ip):
            return JSONResponse(
                {"detail": "尝试过于频繁，请一分钟后再试"},
                status_code=429,
                headers={"Retry-After": "60"},
            )
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > 4096:
                raise HTTPException(413, "登录信息过长")
        try:
            data = json.loads(body)
            username, password = data["username"], data["password"]
            if (
                not isinstance(username, str)
                or not isinstance(password, str)
                or len(username) > 32
                or len(password) > 1024
            ):
                raise ValueError
        except (ValueError, KeyError, TypeError):
            raise HTTPException(400, "请填写有效的用户名和密码") from None
        account = accounts.get(username)
        verified = await run_in_threadpool(
            _verify, password, account["password_hash"] if account else dummy_hash
        )
        if not account or not verified:
            raise HTTPException(401, "用户名或密码不正确")
        token = sessions.create(
            username, account["password_hash"], request.cookies.get(COOKIE, "")
        )
        response = JSONResponse({"enabled": True, "username": username})
        response.set_cookie(
            COOKIE,
            token,
            max_age=SESSION_SECONDS,
            path="/",
            secure=True,
            httponly=True,
            samesite="strict",
        )
        return response

    @app.post("/auth/logout")
    def logout(request: Request):
        check_origin(request)
        sessions.revoke(request.cookies.get(COOKIE, ""))
        response = JSONResponse({"ok": True})
        response.delete_cookie(
            COOKIE, path="/", secure=True, httponly=True, samesite="strict"
        )
        return response

    @app.api_route(
        "/api/{path:path}",
        methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    )
    async def proxy(path: str, request: Request):
        username = identity(request)
        expected = request.headers.get("x-ec-account")
        if username is None or (expected is not None and expected != username):
            raise HTTPException(401, "登录已失效或账号已切换，请重新登录")
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            check_origin(request)
            if expected != username:
                raise HTTPException(401, "请刷新页面后再操作")
        # The fixed account map is the only backend selector. Strip all browser
        # credentials/identity claims before direct loopback management calls.
        connection_tokens = {
            part.strip().lower()
            for part in request.headers.get("connection", "").split(",")
        }
        blocked = (
            HOP_HEADERS
            | connection_tokens
            | {
                "host",
                "cookie",
                "authorization",
                "forwarded",
                "x-real-ip",
                "x-ec-account",
            }
        )
        headers = [
            (k, v)
            for k, v in request.headers.items()
            if k.lower() not in blocked and not k.lower().startswith("x-forwarded-")
        ]
        raw_path = request.scope["raw_path"]
        if request.scope["query_string"]:
            raw_path += b"?" + request.scope["query_string"]
        url = httpx.URL(accounts[username]["backend_url"]).copy_with(raw_path=raw_path)
        client = request.app.state.upstream
        try:
            outgoing = client.build_request(
                request.method, url, headers=headers, content=request.stream()
            )
            upstream = await client.send(outgoing, stream=True)
        except httpx.HTTPError:
            raise HTTPException(502, "学习服务暂时不可用，请稍后重试") from None
        response_blocked = (
            HOP_HEADERS
            | {"set-cookie"}
            | {
                part.strip().lower()
                for part in upstream.headers.get("connection", "").split(",")
            }
        )
        response_headers = {
            k: v
            for k, v in upstream.headers.items()
            if k.lower() not in response_blocked
        }

        async def chunks():
            try:
                async for chunk in upstream.aiter_raw():
                    yield chunk
            finally:
                await upstream.aclose()

        return StreamingResponse(
            chunks(), status_code=upstream.status_code, headers=response_headers
        )

    app.mount("/static", StaticFiles(directory=static_dir), name="static")

    @app.get("/")
    @app.get("/login")
    def index():
        return FileResponse(static_dir / "index.html")

    return app


def gateway_from_env() -> FastAPI:
    """No permissive defaults: a missing deployment config prevents startup."""
    return create_gateway(
        config_path=Path(os.environ["EC_GATEWAY_CONFIG"]),
        session_db=Path(os.environ["EC_GATEWAY_SESSIONS"]),
        static_dir=Path(os.environ["EC_GATEWAY_STATIC"]),
    )
