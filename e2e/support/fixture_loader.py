"""把 JSON fixture 载入已迁移的 SQLite 数据库。

fixture 形状：{"tables": {"cards": [{...}], ...}}，也接受直接以表名为键的映射。
只用于测试前置数据，不经过生产 HTTP 接口。按父表→子表顺序插入，ISO 时间字符串
会转换为 datetime。
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy import Date, DateTime
from sqlalchemy.engine import Engine

from app import models  # noqa: F401 — 注册全部模型表
from app.db import Base


def _ordered_tables(names: list[str]) -> list[str]:
    """按外键依赖做简单拓扑排序（父表先插入）。"""
    remaining = set(names)
    ordered: list[str] = []
    while remaining:
        progressed = False
        for name in sorted(remaining):
            table = Base.metadata.tables[name]
            parents = {fk.column.table.name for fk in table.foreign_keys}
            if parents <= set(ordered) | (parents - remaining):
                ordered.append(name)
                remaining.remove(name)
                progressed = True
                break
        if not progressed:  # 循环依赖或未知表：保持确定顺序，交给数据库报错
            ordered.extend(sorted(remaining))
            break
    return ordered


def _convert_row(table, row: dict[str, Any]) -> dict[str, Any]:
    converted: dict[str, Any] = {}
    for key, value in row.items():
        column = table.columns.get(key)
        if column is not None and isinstance(value, str):
            if isinstance(column.type, DateTime):
                value = datetime.fromisoformat(value.replace("Z", "+00:00"))
            elif isinstance(column.type, Date):
                value = date.fromisoformat(value)
        converted[key] = value
    return converted


def load_fixture(engine: Engine, payload: dict[str, Any]) -> None:
    tables = payload.get("tables")
    if tables is None:
        tables = {
            name: rows
            for name, rows in payload.items()
            if name in Base.metadata.tables and isinstance(rows, list)
        }
    known = [name for name in tables if name in Base.metadata.tables]
    with engine.begin() as conn:
        for name in _ordered_tables(known):
            table = Base.metadata.tables[name]
            for row in tables.get(name) or []:
                conn.execute(table.insert().values(**_convert_row(table, row)))
