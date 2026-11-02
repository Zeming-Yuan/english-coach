"""Expand practice contexts with delayed-check bases; old rows remain readable."""

import sqlalchemy as sa

from alembic import op

revision = "el09_delayed_recall"
down_revision = "el08_practice_contexts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "practice_sessions", sa.Column("window", sa.String(10), nullable=True)
    )
    op.add_column(
        "practice_sessions",
        sa.Column(
            "pending_contact_ids", sa.JSON(), nullable=False, server_default="[]"
        ),
    )
    op.add_column(
        "practice_items", sa.Column("retention_basis", sa.JSON(), nullable=True)
    )
    op.add_column(
        "practice_items", sa.Column("retention_result", sa.JSON(), nullable=True)
    )


def downgrade() -> None:
    # Functional rollback hides the entry while preserving evidence and adapters.
    raise RuntimeError(
        "EL-09 contains learning evidence; use functional rollback, not destructive downgrade"
    )
