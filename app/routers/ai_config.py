"""AI 服务配置路由：设置页自行填写地址/密钥/模型，保存后热生效。"""

from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, field_validator

from app.config import Settings
from app.services import ai_config_store
from app.services.llm_client import LazyLLMClient

router = APIRouter()


class AIConfigIn(BaseModel):
    base_url: str
    model: str
    api_key: str | None = None

    @field_validator("base_url")
    @classmethod
    def _check_base_url(cls, value: str) -> str:
        value = value.strip().rstrip("/")
        if not value.startswith(("http://", "https://")):
            raise ValueError("服务地址必须以 http:// 或 https:// 开头")
        return value

    @field_validator("model")
    @classmethod
    def _check_model(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("模型不能为空")
        return value


def _probe(settings: Settings) -> None:
    """用候选配置发一次最小请求；失败时抛异常由调用方转成可读原因。"""
    client = LazyLLMClient(settings)
    client.chat.completions.create(
        model=settings.llm_model,
        messages=[{"role": "user", "content": "ping"}],
        max_tokens=1,
    )


def _error_text(exc: Exception) -> str:
    text = str(exc).strip() or type(exc).__name__
    return text[:300]


def _reject_keyless_address_change(settings: Settings, payload: AIConfigIn) -> None:
    """换地址时必须重新输入密钥，不把已存密钥发往新地址。"""
    if (payload.api_key or "").strip():
        return
    current = settings.llm_base_url.strip().rstrip("/").lower()
    if payload.base_url.lower() != current:
        raise HTTPException(status_code=400, detail="更换服务地址时请重新输入 API Key")


@router.get("/ai-config")
def get_ai_config(request: Request):
    return ai_config_store.public_view(request.app.state.settings)


@router.put("/ai-config")
def put_ai_config(payload: AIConfigIn, request: Request):
    settings = request.app.state.settings
    _reject_keyless_address_change(settings, payload)
    path: Path = request.app.state.llm_config_path
    try:
        ai_config_store.save(
            path,
            base_url=payload.base_url,
            model=payload.model,
            api_key=payload.api_key,
        )
    except (OSError, ValueError) as exc:
        raise HTTPException(
            status_code=503, detail="无法保存 AI 配置；请检查本机配置文件"
        ) from exc
    ai_config_store.load_into(settings, path)
    # 客户端缓存了旧配置，换新实例让后续请求立即使用新配置。
    request.app.state.llm_client = LazyLLMClient(settings)
    return ai_config_store.public_view(settings)


@router.post("/ai-config/test")
def test_ai_config(payload: AIConfigIn, request: Request):
    settings = request.app.state.settings
    _reject_keyless_address_change(settings, payload)
    api_key = (payload.api_key or "").strip() or settings.llm_api_key
    candidate = settings.model_copy(
        update={
            "llm_base_url": payload.base_url,
            "llm_model": payload.model,
            "llm_api_key": api_key,
        }
    )
    try:
        _probe(candidate)
    except Exception as exc:  # noqa: BLE001 — 任何失败都要变成可读原因
        return {"ok": False, "error": _error_text(exc)}
    return {"ok": True}
