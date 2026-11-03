"""Give in-flight scene expressions a restore-safe instance token."""

from uuid import uuid4

import sqlalchemy as sa

from alembic import op

revision = "el16_feedback_epoch"
down_revision = "el16_scene_feedback"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "practice_sessions", sa.Column("feedback_epoch", sa.String(36), nullable=True)
    )
    sessions = sa.table(
        "practice_sessions",
        sa.column("id"),
        sa.column("purpose"),
        sa.column("feedback_epoch"),
    )
    connection = op.get_bind()
    for row_id in connection.execute(
        sa.select(sessions.c.id).where(sessions.c.purpose == "scene")
    ).scalars():
        connection.execute(
            sessions.update()
            .where(sessions.c.id == row_id)
            .values(feedback_epoch=str(uuid4()))
        )


def downgrade():
    raise RuntimeError("保留场景记录与反馈恢复隔离；关闭模型增强执行功能回退")
