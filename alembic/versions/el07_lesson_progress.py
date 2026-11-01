"""Add explicit lesson generation and browsing progress.

Revision ID: el07_lesson_progress
Revises: el04_learning_contacts
"""

import sqlalchemy as sa

from alembic import op

revision = "el07_lesson_progress"
down_revision = "el04_learning_contacts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "lesson_progress",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "lesson_id",
            sa.Integer(),
            sa.ForeignKey("lessons.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("generation_id", sa.String(length=36), nullable=False),
        sa.Column("generated", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("generated_at", sa.DateTime(), nullable=False),
        sa.Column("opened", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("opened_at", sa.DateTime(), nullable=True),
        sa.Column("browsed", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("browsed_at", sa.DateTime(), nullable=True),
        sa.Column("view_submission_id", sa.String(length=36), nullable=True),
        sa.Column("view_submissions", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("checked_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("passed_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index(
        "ix_lesson_progress_lesson_id",
        "lesson_progress",
        ["lesson_id"],
        unique=True,
    )
    op.create_index(
        "ix_lesson_progress_generation_id",
        "lesson_progress",
        ["generation_id"],
        unique=True,
    )
    op.create_index(
        "ix_lesson_progress_view_submission_id",
        "lesson_progress",
        ["view_submission_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_lesson_progress_view_submission_id", table_name="lesson_progress"
    )
    op.drop_index("ix_lesson_progress_generation_id", table_name="lesson_progress")
    op.drop_index("ix_lesson_progress_lesson_id", table_name="lesson_progress")
    op.drop_table("lesson_progress")
