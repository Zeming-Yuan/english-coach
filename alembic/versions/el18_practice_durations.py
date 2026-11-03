"""Add active workload samples without changing saved answers or schedules."""

import sqlalchemy as sa

from alembic import op

revision = "el18_practice_durations"
down_revision = "el16_feedback_epoch"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "practice_durations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("sample_id", sa.String(36), nullable=False, unique=True),
        sa.Column(
            "submission_id",
            sa.String(36),
            sa.ForeignKey("review_events.submission_id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("active_ms", sa.Integer(), nullable=False),
        sa.Column("rule_version", sa.String(32), nullable=False),
        sa.Column("occurred_at", sa.DateTime(), nullable=False),
    )


def downgrade():
    raise RuntimeError(
        "Retain duration records and V3 adapters; disable personal estimates instead"
    )
