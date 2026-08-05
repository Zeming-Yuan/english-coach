"""应用配置：从 .env / 环境变量读取。"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """集中管理所有配置项，.env 中的值会自动覆盖默认值。"""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    # DeepSeek API（OpenAI 兼容协议）
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"

    # 数据库连接（默认本地 SQLite）
    database_url: str = "sqlite:///./data/english_coach.db"

    # 学习参数
    daily_new_words: int = 10


settings = Settings()
