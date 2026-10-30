"""LLM 调用深模块：把「一段 prompt → dict/str」做成一个小接口。

契约（调用方只需知道这些）：
- generate_json / generate_text 永不抛异常：网络故障、空内容、JSON 不合法
  一律返回 None，由调用方决定兜底（报错 / 用本地数据 / 静默）。
- AI 配置（客户端构造、timeout、模型路由）只在这里；调用方不要自建 OpenAI 客户端。

用法：data = generate_json(SYSTEM_PROMPT, user_text)
     if data is None:  # 调用方兜底
"""

import json

from openai import OpenAI

from app.config import settings
from app.services.model_router import Task, route

client = OpenAI(
    api_key=settings.llm_api_key,
    base_url=settings.llm_base_url,
    timeout=30,  # AI 调用一律限时 30s，防止默认 600s 拖住请求
)


def _complete(system: str, user: str | None, task: Task) -> str | None:
    """一次 chat 调用，返回原始 content；失败或空内容返回 None（永不抛）。"""
    messages = [{"role": "system", "content": system}]
    if user is not None:
        messages.append({"role": "user", "content": user})
    try:
        resp = client.chat.completions.create(
            model=route(task),
            messages=messages,
            response_format={"type": "json_object"},
        )
    except Exception:  # noqa: BLE001 — AI 故障统一走 None 契约，不暴露
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
