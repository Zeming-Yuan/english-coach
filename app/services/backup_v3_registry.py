"""V3 extension registry shared by export, validation and restore.

Schemas declare each feature once. This module owns the registration API;
the original schema import path re-exports it for existing consumers.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from pydantic import BaseModel


@dataclass(frozen=True)
class ExtensionSpec:
    """一个已登记的 V3 扩展集合。"""

    name: str
    schema: type[BaseModel]
    parents: tuple[str, ...]
    remap: Callable[[dict, dict[str, dict[int, int]]], dict]
    model: type | None = None
    complete: bool = False
    unique: tuple[str, ...] = ()


_EXTENSIONS: dict[str, ExtensionSpec] = {}


def extension_names_match(declared: list[str], actual: list[str]) -> bool:
    """A snapshot declares every supplied collection exactly once."""
    return len(declared) == len(set(declared)) and set(declared) == set(actual)


def register_extension(
    name: str,
    schema: type[BaseModel],
    parents: tuple[str, ...],
    remap: Callable[[dict, dict[str, dict[int, int]]], dict],
    *,
    model: type | None = None,
    complete: bool = False,
    unique: tuple[str, ...] = (),
) -> None:
    """登记扩展集合；重复登记是编程错误，拒绝静默覆盖。

    model 是导出与恢复删除拓扑使用的持久模型；登记顺序即导出顺序。
    complete 表示快照必须为每个父实体包含一行（如当前修订身份）。
    unique 表示集合内不得重复的字段（如提交标识）。
    """
    if name in _EXTENSIONS:
        raise ValueError(f"扩展集合已登记：{name}")
    _EXTENSIONS[name] = ExtensionSpec(
        name, schema, parents, remap, model, complete, unique
    )


def registered_extensions() -> dict[str, ExtensionSpec]:
    # Load declarations once on first use; schemas may also import this API.
    # Keeping this lazy prevents the schema/registry dependency from cycling.
    from app.schemas import backup_v3  # noqa: F401

    return dict(_EXTENSIONS)
