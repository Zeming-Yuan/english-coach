"""repair missing reviews.rating column

Revision ID: b1c2d3e4f501
Revises: a9f3e7d1c2b4
Create Date: 2026-10-30 00:00:00.000000

历史迁移 8154110d67de 内容为空，真实迁移链建出的 reviews 表缺少 rating 列；
旧库也可能已标记该迁移完成但实际缺列。本迁移按实际结构向前修复，不修改历史迁移。
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b1c2d3e4f501"
down_revision: str | Sequence[str] | None = "a9f3e7d1c2b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """补上缺失的评分列；已存在时不重复添加。"""
    columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("reviews")}
    if "rating" not in columns:
        op.add_column("reviews", sa.Column("rating", sa.Integer(), nullable=True))


def downgrade() -> None:
    """兼容列保留，避免回退时抹掉已记录的评分。"""
    return
