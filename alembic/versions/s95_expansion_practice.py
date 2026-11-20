"""Freeze the confirmed addition and material used by contextual practice."""

import sqlalchemy as sa

from alembic import op

revision = "s95_expansion_practice"
down_revision = "s95_expansion_additions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "practice_sessions", sa.Column("expansion_snapshot", sa.JSON(), nullable=True)
    )


def downgrade() -> None:
    raise RuntimeError("Keep contextual practice history; roll back the entry point")
