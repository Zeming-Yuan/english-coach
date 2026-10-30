"""LLM 调用深模块：把「一段 prompt → dict/str」做成一个小接口。

契约（调用方只需知道这些）：
- generate_json / generate_text 对网络故障、空内容、JSON 不合法一律返回 None，
  由调用方决定兜底（报错 / 用本地数据 / 静默）。
- 唯一例外：AI 未配置时抛 LLMNotConfigured，由应用统一映射为 HTTP 503；
  调用方默认不要吞掉它，否则界面无法区分“未配置”和普通生成失败。
  仅当该路径明确是可选的 AI 增强（失败时原文/已有内容仍可用）才允许降级。
- AI 配置（延迟客户端构造、timeout、模型路由）只在这里；调用方不要自建 OpenAI 客户端。

用法：data = generate_json(SYSTEM_PROMPT, user_text)
     if data is None:  # 调用方兜底
"""

import json
from contextvars import ContextVar

from app.config import settings
from app.services.llm_client import LazyLLMClient, LLMNotConfigured
from app.services.model_router import Task, route

# 模块级默认客户端：保留 client 名称供现有测试替换；生产请求由中间件绑定到
# app.state.llm_client，避免同进程多实例互相覆盖 AI 配置。
client = LazyLLMClient(settings)
_active_client: ContextVar[LazyLLMClient | None] = ContextVar(
    "englishcoach_llm_client", default=None
)


def bind_llm_client(new_client: LazyLLMClient):
    """请求进入时绑定所属应用实例的客户端；返回用于恢复的 token。"""
    return _active_client.set(new_client)


def reset_llm_client(token) -> None:
    """请求结束时恢复之前的绑定。"""
    _active_client.reset(token)


def current_llm_client() -> LazyLLMClient:
    """当前请求绑定的客户端；无绑定（如后台线程）回落到模块级默认。"""
    return _active_client.get() or client


def _complete(system: str, user: str | None, task: Task) -> str | None:
    """一次 chat 调用，返回原始 content；失败或空内容返回 None（永不抛）。

    唯一例外：AI 未配置时抛 LLMNotConfigured，由 HTTP 层映射为 503。
    """
    messages = [{"role": "system", "content": system}]
    if user is not None:
        messages.append({"role": "user", "content": user})
    try:
        resp = current_llm_client().chat.completions.create(
            model=route(task),
            messages=messages,
            response_format={"type": "json_object"},
        )
    except LLMNotConfigured:
        raise
    except Exception:  # noqa: BLE001 — 其余 AI 故障统一走 None 契约，不暴露
        return None
    content = resp.choices[0].message.content
    return content or None


def generate_json(
    system: str,
    user: str | None = None,
    task: Task = Task.BULK,
) -> dict | None:
    """严格 JSON 输出约定下的生成；解析失败返回 None。"""
    content = _complete(system, user, task)
    if content is None:
        return None
    try:
        data = json.loads(content)
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def generate_text(system: str, user: str | None = None, task: Task = Task.BULK) -> str | None:
    """纯文本生成（不做 JSON 解析）。"""
    return _complete(system, user, task)
