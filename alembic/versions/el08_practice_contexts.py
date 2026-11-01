"""Add persistent lesson-check practice sessions and frozen items.

Revision ID: el08_practice_contexts
Revises: el07_lesson_progress
"""

import sqlalchemy as sa

from alembic import op

revision = "el08_practice_contexts"
down_revision = "el07_lesson_progress"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "practice_sessions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("purpose", sa.String(length=30), nullable=False),
        sa.Column(
            "lesson_id",
            sa.Integer(),
            sa.ForeignKey("lessons.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("rule_version", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
    )
    op.create_index(
        "ix_practice_sessions_session_id",
        "practice_sessions",
        ["session_id"],
        unique=True,
    )
    op.create_index(
        "ix_practice_sessions_lesson_id", "practice_sessions", ["lesson_id"]
    )
    op.create_table(
        "practice_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("item_id", sa.String(length=36), nullable=False),
        sa.Column(
            "session_id",
            sa.String(length=36),
            sa.ForeignKey("practice_sessions.session_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column(
            "card_id",
            sa.Integer(),
            sa.ForeignKey("cards.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("card_identity", sa.String(length=36), nullable=False),
        sa.Column("card_revision", sa.Integer(), nullable=False),
        sa.Column("prompt", sa.String(length=500), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("assistance", sa.JSON(), nullable=False),
        sa.Column("first_event_id", sa.String(length=36), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint(
            "session_id", "position", name="uq_practice_item_position"
        ),
        sa.UniqueConstraint("session_id", "card_id", name="uq_practice_item_card"),
    )
    op.create_index(
        "ix_practice_items_item_id", "practice_items", ["item_id"], unique=True
    )
    op.create_index("ix_practice_items_session_id", "practice_items", ["session_id"])
    op.create_index("ix_practice_items_card_id", "practice_items", ["card_id"])
    op.create_index(
        "ix_practice_items_first_event_id",
        "practice_items",
        ["first_event_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_practice_items_first_event_id", table_name="practice_items")
    op.drop_index("ix_practice_items_card_id", table_name="practice_items")
    op.drop_index("ix_practice_items_session_id", table_name="practice_items")
    op.drop_index("ix_practice_items_item_id", table_name="practice_items")
    op.drop_table("practice_items")
    op.drop_index("ix_practice_sessions_lesson_id", table_name="practice_sessions")
    op.drop_index("ix_practice_sessions_session_id", table_name="practice_sessions")
    op.drop_table("practice_sessions")
