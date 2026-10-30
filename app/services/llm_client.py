"""LLM 客户端延迟初始化：缺少配置时给出可识别的未配置错误。

契约：
- 构造 LazyLLMClient 不读取密钥、不建立网络客户端。
- 真正发起请求（访问 chat）时才检查配置并创建 OpenAI 客户端。
- 缺少 LLM_API_KEY 抛 LLMNotConfigured；错误信息不包含任何密钥。
"""

from __future__ import annotations

from openai import OpenAI

from app.config import Settings


class LLMNotConfigured(RuntimeError):
    """AI 功能未配置；由应用统一映射为 HTTP 503。"""


class LazyLLMClient:
    """按需创建的 OpenAI 兼容客户端。"""

    def __init__(self, settings: Settings):
        self._settings = settings
        self._openai: OpenAI | None = None

    @property
    def chat(self):
        return self._client().chat

    def _client(self) -> OpenAI:
        if not self._settings.llm_api_key:
            raise LLMNotConfigured(
                "AI 未配置：请在 .env 设置 LLM_API_KEY 与 LLM_BASE_URL"
                "（见 README 配置说明）。本地学习功能不受影响。"
            )
        if self._openai is None:
            self._openai = OpenAI(
                api_key=self._settings.llm_api_key,
                base_url=self._settings.llm_base_url,
                timeout=30,  # AI 调用一律限时 30s，防止默认 600s 拖住请求
            )
        return self._openai
