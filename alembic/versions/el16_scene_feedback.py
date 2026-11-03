"""Retain bounded feedback separately from authoritative scene answers."""

import sqlalchemy as sa

from alembic import op

revision = "el16_scene_feedback"
down_revision = "el14_scene_attempts"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "scene_feedback",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("operation_id", sa.String(36), unique=True, nullable=False),
        sa.Column(
            "session_id",
            sa.String(36),
            sa.ForeignKey("practice_sessions.session_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "item_id",
            sa.String(36),
            sa.ForeignKey("practice_items.item_id", ondelete="CASCADE"),
            unique=True,
            nullable=False,
        ),
        sa.Column(
            "attempt_id",
            sa.String(36),
            sa.ForeignKey("scene_attempts.attempt_id", ondelete="CASCADE"),
            unique=True,
            nullable=False,
        ),
        sa.Column("rule_version", sa.String(30), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("feedback_version", sa.String(30), nullable=False),
        sa.Column("text", sa.String(200), nullable=False),
        sa.Column("correction", sa.String(500), nullable=True),
        sa.Column("origin", sa.String(20), nullable=False),
        sa.Column("occurred_at", sa.DateTime(), nullable=False),
    )


def downgrade():
    raise RuntimeError("保留反馈与场景记录；关闭模型增强执行功能回退")
