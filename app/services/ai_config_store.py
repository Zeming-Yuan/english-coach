"""AI 服务配置持久化：界面填写的地址/模型/密钥保存在本机文件。

优先级：llm_config.json（设置页保存）> .env。
密钥只写入本机文件，接口永不返回；备份只导出数据库，不包含此文件。
"""

import json
import os
import tempfile
from pathlib import Path

from app.config import Settings


def public_view(settings: Settings) -> dict:
    """可安全返回给前端的配置视图。"""
    return {
        "base_url": settings.llm_base_url,
        "model": settings.llm_model,
        "has_key": bool(settings.llm_api_key),
    }


def load_into(settings: Settings, path: Path) -> None:
    """把已保存的配置应用到 settings；文件缺失或损坏时保持原配置。"""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return
    if not isinstance(data, dict):
        return

    base_url = data.get("base_url")
    if isinstance(base_url, str) and base_url.strip():
        settings.llm_base_url = base_url.strip()
    model = data.get("model")
    if isinstance(model, str) and model.strip():
        settings.llm_model = model.strip()
    api_key = data.get("api_key")
    if isinstance(api_key, str) and api_key.strip():
        settings.llm_api_key = api_key.strip()


def save(path: Path, *, base_url: str, model: str, api_key: str | None) -> None:
    """原子写入；api_key 为空表示沿用文件中已有的密钥。"""
    current: dict = {}
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(loaded, dict):
            current = loaded
    except (OSError, ValueError):
        pass

    payload = {"base_url": base_url, "model": model}
    key = (api_key or "").strip()
    if key:
        payload["api_key"] = key
    elif isinstance(current.get("api_key"), str) and current["api_key"]:
        payload["api_key"] = current["api_key"]

    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        dir=path.parent, prefix=f"{path.name}.", suffix=".tmp"
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(json.dumps(payload, ensure_ascii=False, indent=2))
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp_name, path)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise
