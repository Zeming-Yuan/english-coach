"""写事务所有权：路由不提交，写模块持有 BEGIN IMMEDIATE 与 commit/rollback。

SQLite 的 BEGIN IMMEDIATE 在第一条语句就取得写锁，保证幂等检查、事件追加、
排期与错词更新处于同一临界区；任何一步异常都整体回滚。
"""

from collections.abc import Callable
from typing import TypeVar

from sqlalchemy import text
from sqlalchemy.orm import Session

T = TypeVar("T")


def _dbapi_transaction_active(db: Session) -> bool:
    """Session 可能已因只读查询 autobegin；真正需要拒绝的是 DBAPI 写事务。"""
    try:
        connection = db.connection().connection.driver_connection
    except Exception:  # noqa: BLE001 — 无法确认时按不干净处理
        return True
    return bool(getattr(connection, "in_transaction", False))


def run_write(db: Session, operation: Callable[[Session], T]) -> T:
    """在干净会话中以 BEGIN IMMEDIATE 执行一次写事务。"""
    if db.in_transaction() and _dbapi_transaction_active(db):
        raise RuntimeError("write module requires a clean request session")
    try:
        db.execute(text("BEGIN IMMEDIATE"))
        result = operation(db)
        db.commit()
        return result
    except BaseException:
        db.rollback()
        raise
