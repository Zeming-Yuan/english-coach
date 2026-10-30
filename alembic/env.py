from logging.config import fileConfig

from sqlalchemy import create_engine, pool
from sqlalchemy.engine import make_url
from sqlalchemy.exc import OperationalError

from alembic import context
from app import models  # noqa: F401
from app.config import settings
from app.db import Base, backup_sqlite_database

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# add your model's MetaData object here
# for 'autogenerate' support
# from myapp import mymodel
# target_metadata = mymodel.Base.metadata
target_metadata = Base.metadata

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


def _database_url() -> str:
    """测试显式设置的 URL 优先；否则与应用共用 Settings.database_url。"""
    return config.get_main_option("sqlalchemy.url") or settings.database_url


def _safe_url(url: str) -> str:
    """展示数据库地址时隐藏口令等敏感信息。"""
    try:
        return make_url(url).render_as_string(hide_password=True)
    except Exception:  # noqa: BLE001 — 非法地址只作为文本展示
        return "(invalid database url)"


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = _database_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.

    """
    url = _database_url()
    # 已初始化的旧库：先落可恢复副本，校验成功才继续迁移
    backup = backup_sqlite_database(url)
    if backup is not None:
        print(f"[alembic] 升级前数据库备份：{backup}")
    connectable = create_engine(url, poolclass=pool.NullPool)

    try:
        with connectable.connect() as connection:
            context.configure(connection=connection, target_metadata=target_metadata)

            with context.begin_transaction():
                context.run_migrations()
    except OperationalError as exc:
        origin = getattr(exc, "orig", None)
        reason = str(origin or exc)
        lowered = reason.lower()
        if any(
            hint in lowered
            for hint in ("readonly", "read-only", "unable to open", "permission denied")
        ):
            raise RuntimeError(
                f"数据库不可写或不可访问（{_safe_url(url)}）：{reason}。"
                "请检查 DATABASE_URL 指向的文件/目录权限。"
            ) from exc
        raise


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
