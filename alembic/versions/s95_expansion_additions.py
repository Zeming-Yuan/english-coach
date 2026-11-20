"""Add confirmed expansion selections without changing existing learning data."""

import sqlalchemy as sa

from alembic import op

revision = "s95_expansion_additions"
down_revision = "reliability_practice_weak_only"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "expansion_additions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("operation_id", sa.String(36), nullable=False, unique=True),
        sa.Column(
            "source_card_id",
            sa.Integer(),
            sa.ForeignKey("cards.id", ondelete="SET NULL"),
        ),
        sa.Column(
            "target_card_id",
            sa.Integer(),
            sa.ForeignKey("cards.id", ondelete="SET NULL"),
        ),
        sa.Column("original_source_id", sa.Integer(), nullable=False),
        sa.Column("source_identity", sa.String(36), nullable=False),
        sa.Column("source_version", sa.Integer(), nullable=False),
        sa.Column("target_identity", sa.String(36), nullable=False),
        sa.Column("target_word", sa.String(80), nullable=False),
        sa.Column("target_meaning", sa.String(200), nullable=False),
        sa.Column("created", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    for field in ("source_card_id", "target_card_id"):
        op.create_index(
            f"ix_expansion_additions_{field}", "expansion_additions", [field]
        )


def downgrade() -> None:
    raise RuntimeError("Keep confirmed additions and back up before rolling back")
