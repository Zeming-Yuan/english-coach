"""Expand immutable story versions with simpler-mode parent identity."""

import sqlalchemy as sa

from alembic import op

revision = "el12_simpler_story"
down_revision = "el11_story_versions"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "story_versions",
        sa.Column("mode", sa.String(10), nullable=False, server_default="normal"),
    )
    op.add_column(
        "story_versions", sa.Column("parent_version_id", sa.String(36), nullable=True)
    )


def downgrade():
    raise RuntimeError(
        "EL-12 preserves versions; disable simplification for functional rollback"
    )
