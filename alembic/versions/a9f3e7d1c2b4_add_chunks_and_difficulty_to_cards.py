"""add chunks and difficulty to cards

Revision ID: a9f3e7d1c2b4
Revises: 606c62aa4e7e
Create Date: 2026-08-25 21:10:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a9f3e7d1c2b4"
down_revision: str | Sequence[str] | None = "fad563d280fa"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("cards", sa.Column("chunks", sa.JSON(), nullable=True))
    op.add_column("cards", sa.Column("difficulty", sa.String(length=10), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("cards", "difficulty")
    op.drop_column("cards", "chunks")
