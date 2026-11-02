"""Bind reading checks to immutable story versions; retain existing practice rows."""

import sqlalchemy as sa

from alembic import op

revision = "el13_story_checks"
down_revision = "el11_story_versions"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("practice_sessions") as batch:
        batch.add_column(sa.Column("version_id", sa.String(36), nullable=True))
        batch.create_foreign_key(
            "fk_practice_story_version",
            "story_versions",
            ["version_id"],
            ["version_id"],
        )
        batch.create_index("ix_practice_sessions_version_id", ["version_id"])
    with op.batch_alter_table("practice_items") as batch:
        batch.add_column(sa.Column("question", sa.JSON(), nullable=True))
        batch.drop_constraint("uq_practice_item_card", type_="unique")
        batch.create_unique_constraint(
            "uq_practice_item_card_kind", ["session_id", "card_id", "kind"]
        )


def downgrade():
    raise RuntimeError("保留读后检查历史；请关闭入口执行功能回退，不删除已有记录")
