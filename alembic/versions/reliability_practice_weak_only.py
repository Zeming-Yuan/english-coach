"""Keep the lesson-check selection policy in its replay identity."""

import sqlalchemy as sa

from alembic import op

revision = "reliability_practice_weak_only"
down_revision = "el18_practice_durations"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "practice_sessions",
        sa.Column("weak_only", sa.Boolean(), nullable=False, server_default=sa.false()),
    )

    op.add_column(
        "practice_sessions",
        sa.Column(
            "targets_explicit", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )


def downgrade():
    raise RuntimeError("Keep saved replay identities; roll back the feature instead")
