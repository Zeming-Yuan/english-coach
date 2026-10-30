"""可验证题目上下文：服务端判分不信任客户端下标或正误。

token = base64url(规范化 JSON 上下文) + "." + HMAC-SHA256 十六进制。
上下文绑定 card_id、kind、options、expected、expires_at 与密钥标识；
签名密钥由应用启动生成，同实例各请求一致，重启后旧 token 失效。
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
from datetime import datetime, timedelta, timezone

from app.models.card import Card

DEFAULT_TTL = timedelta(hours=24)
ALLOWED_KINDS = {"choice", "related"}


class InvalidQuestionToken(ValueError):
    """token 损坏、签名不符或字段不合法（HTTP 422）。"""


class QuestionTokenExpired(InvalidQuestionToken):
    """签名有效但已过期（HTTP 409，需重新加载题目）。"""


class QuestionTokenStale(InvalidQuestionToken):
    """由其他应用实例签发（重启后旧 token，HTTP 409）。"""


def new_question_secret() -> bytes:
    """应用启动时生成的新密钥；不来自客户端，不进入备份。"""
    return secrets.token_bytes(32)


def _key_id(secret: bytes) -> str:
    return hashlib.sha256(secret).hexdigest()[:16]


def _canonical(payload: dict) -> bytes:
    return json.dumps(
        payload, sort_keys=True, ensure_ascii=False, separators=(",", ":")
    ).encode("utf-8")


def _sign(raw: bytes, secret: bytes) -> str:
    return hmac.new(secret, raw, hashlib.sha256).hexdigest()


def issue_question(
    card: Card,
    kind: str,
    options: list[str],
    expected: str,
    secret: bytes,
    *,
    now: datetime | None = None,
    ttl: timedelta = DEFAULT_TTL,
) -> dict:
    """签发一道客观选择题的上下文；返回上下文与 token。"""
    if kind not in ALLOWED_KINDS:
        raise ValueError(f"unsupported question kind: {kind}")
    options = list(options)
    if expected not in options:
        raise ValueError("expected answer must be one of the options")
    issued_at = now or datetime.now(timezone.utc)
    if issued_at.tzinfo is None:
        issued_at = issued_at.replace(tzinfo=timezone.utc)
    payload = {
        "card_id": card.id,
        "kind": kind,
        "options": options,
        "expected": expected,
        "expires_at": (issued_at + ttl).astimezone(timezone.utc).isoformat(),
        "kid": _key_id(secret),
    }
    raw = _canonical(payload)
    token = base64.urlsafe_b64encode(raw).decode("ascii") + "." + _sign(raw, secret)
    return {**payload, "token": token}


def _decode(token: str) -> dict:
    try:
        encoded, signature = token.rsplit(".", 1)
        raw = base64.urlsafe_b64decode(encoded.encode("ascii"))
        payload = json.loads(raw)
    except (ValueError, TypeError, UnicodeError) as error:
        raise InvalidQuestionToken("题目上下文无效，请重新加载题目") from error
    if not isinstance(payload, dict):
        raise InvalidQuestionToken("题目上下文无效，请重新加载题目")
    return {"payload": payload, "raw": raw, "signature": signature}


def business_context(verified: dict) -> dict:
    """参与幂等指纹的业务上下文；不含随机签名与过期时间。"""
    return {
        "card_id": verified["card_id"],
        "kind": verified["kind"],
        "options": list(verified["options"]),
        "expected": verified["expected"],
    }


def verify_question(token: str, secret: bytes, now: datetime) -> dict:
    """验签并校验字段；过期、重启、篡改分别给出可映射的错误。"""
    decoded = _decode(token)
    payload = decoded["payload"]
    if payload.get("kid") != _key_id(secret):
        raise QuestionTokenStale("题目上下文已失效，请重新加载题目")
    expected_signature = _sign(decoded["raw"], secret)
    if not hmac.compare_digest(str(decoded["signature"]), expected_signature):
        raise InvalidQuestionToken("题目上下文无效，请重新加载题目")
    _validate_payload(payload)
    expires_at = datetime.fromisoformat(payload["expires_at"])
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    reference = now if now.tzinfo is not None else now.replace(tzinfo=timezone.utc)
    if reference >= expires_at:
        raise QuestionTokenExpired("题目已过期，请重新加载题目")
    return payload


def _validate_payload(payload: dict) -> None:
    card_id = payload.get("card_id")
    kind = payload.get("kind")
    options = payload.get("options")
    expected = payload.get("expected")
    expires_at = payload.get("expires_at")
    valid = (
        isinstance(card_id, int)
        and not isinstance(card_id, bool)
        and card_id > 0
        and kind in ALLOWED_KINDS
        and isinstance(options, list)
        and options
        and all(isinstance(option, str) for option in options)
        and isinstance(expected, str)
        and expected in options
        and isinstance(expires_at, str)
    )
    if valid:
        try:
            datetime.fromisoformat(expires_at)
        except ValueError:
            valid = False
    if not valid:
        raise InvalidQuestionToken("题目上下文无效，请重新加载题目")
