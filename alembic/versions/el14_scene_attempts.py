"""Expand practice contexts for bounded scene tasks without word scheduling."""

import sqlalchemy as sa

from alembic import op

revision = "el14_scene_attempts"
down_revision = "el13_merge_story_heads"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("practice_sessions") as batch:
        batch.add_column(sa.Column("scene_id", sa.String(30), nullable=True))
        batch.add_column(sa.Column("scene_snapshot", sa.JSON(), nullable=True))
    with op.batch_alter_table("practice_items") as batch:
        batch.alter_column("card_id", existing_type=sa.Integer(), nullable=True)
        batch.alter_column("card_identity", existing_type=sa.String(36), nullable=True)
        batch.alter_column("card_revision", existing_type=sa.Integer(), nullable=True)
        batch.add_column(
            sa.Column("first_task_attempt_id", sa.String(36), nullable=True)
        )

    op.create_table(
        "scene_attempts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("attempt_id", sa.String(36), unique=True, nullable=False),
        sa.Column("submission_id", sa.String(36), unique=True, nullable=False),
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
            nullable=False,
        ),
        sa.Column("answer", sa.String(2000), nullable=True),
        sa.Column("skipped", sa.Boolean(), nullable=False),
        sa.Column("assistance", sa.JSON(), nullable=False),
        sa.Column("verdict", sa.String(20), nullable=False),
        sa.Column("task_key", sa.String(30), nullable=False),
        sa.Column("rule_version", sa.String(30), nullable=False),
        sa.Column("target_mapping", sa.JSON(), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("command_json", sa.JSON(), nullable=False),
        sa.Column("response", sa.JSON(), nullable=False),
        sa.Column("occurred_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_scene_attempts_session_id", "scene_attempts", ["session_id"])
    op.create_index("ix_scene_attempts_item_id", "scene_attempts", ["item_id"])


def downgrade():
    raise RuntimeError("保留场景记录；关闭场景入口执行功能回退，不删除已有数据")
