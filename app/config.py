"""应用配置：从 .env / 环境变量读取。"""

from zoneinfo import ZoneInfo

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class ConfigurationError(RuntimeError):
    """配置不可用：错误信息只说明配置项，不包含任何密钥值。"""


class Settings(BaseSettings):
    """集中管理所有配置项，.env 中的值会自动覆盖默认值。"""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        hide_input_in_errors=True,
    )

    # LLM API（OpenAI 兼容协议，当前：小米 MiMo Token Plan）
    llm_api_key: str = ""
    llm_base_url: str = "https://token-plan-cn.xiaomimimo.com/v1"

    # 数据库连接（默认本地 SQLite）
    database_url: str = "sqlite:///./data/english_coach.db"

    # 学习参数
    daily_new_words: int = 10
    learning_timezone: str = "Asia/Shanghai"

    # 旧版配置项仅用于识别并给出迁移说明，不参与运行
    deepseek_api_key: str = ""
    deepseek_base_url: str = ""

    @field_validator("learning_timezone")
    @classmethod
    def _validate_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except Exception as exc:
            raise ValueError(
                "learning_timezone 必须是有效的 IANA 时区名称（例如 Asia/Shanghai）"
            ) from exc
        return value

    def model_post_init(self, __context: object, /) -> None:
        legacy = [
            name
            for name, value in (
                ("DEEPSEEK_API_KEY", self.deepseek_api_key),
                ("DEEPSEEK_BASE_URL", self.deepseek_base_url),
            )
            if value
        ]
        if not legacy:
            return
        names = "、".join(legacy)
        if self.llm_api_key:
            raise ConfigurationError(
                f"配置冲突：同时设置了 LLM_API_KEY 与 {names}。"
                "请只保留 LLM_API_KEY / LLM_BASE_URL，并确认模型供应商地址。"
            )
        raise ConfigurationError(
            f"检测到旧配置项 {names}。请改用 LLM_API_KEY 与 LLM_BASE_URL"
            "（迁移说明见 .env.example 和 README 的配置章节）。"
        )


settings = Settings()
