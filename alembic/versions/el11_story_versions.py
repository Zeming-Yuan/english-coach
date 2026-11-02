"""Preserve bounded story versions and idempotent generation identities."""

import sqlalchemy as sa

from alembic import op

revision = "el11_story_versions"
down_revision = "el09_delayed_recall"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "story_versions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("story_id", sa.Integer(), sa.ForeignKey("stories.id"), unique=True),
        sa.Column("version_id", sa.String(36), nullable=False, unique=True),
        sa.Column("operation_id", sa.String(36), nullable=False, unique=True),
        sa.Column("include_new_target", sa.Boolean(), nullable=False),
        sa.Column("story_identity", sa.String(36), nullable=False),
        sa.Column("story_revision", sa.Integer(), nullable=False),
        sa.Column("material", sa.JSON(), nullable=False),
        sa.Column("quality", sa.JSON(), nullable=False),
    )


def downgrade():
    raise RuntimeError(
        "EL-11 preserves checked content; disable generation for functional rollback"
    )
