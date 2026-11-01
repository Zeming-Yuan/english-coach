"""Add confirmed in-app learning contacts.

Revision ID: el04_learning_contacts
Revises: el02_event_revision_links
"""

import sqlalchemy as sa

from alembic import op

revision = "el04_learning_contacts"
down_revision = "el02_event_revision_links"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "learning_contacts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("submission_id", sa.String(length=36), nullable=False),
        sa.Column(
            "card_id",
            sa.Integer(),
            sa.ForeignKey("cards.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("card_identity", sa.String(length=36), nullable=False),
        sa.Column("card_revision", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(length=20), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("occurred_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "ix_learning_contacts_submission_id",
        "learning_contacts",
        ["submission_id"],
        unique=True,
    )
    op.create_index("ix_learning_contacts_card_id", "learning_contacts", ["card_id"])
    op.create_index(
        "ix_learning_contacts_occurred_at", "learning_contacts", ["occurred_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_learning_contacts_occurred_at", table_name="learning_contacts")
    op.drop_index("ix_learning_contacts_card_id", table_name="learning_contacts")
    op.drop_index("ix_learning_contacts_submission_id", table_name="learning_contacts")
    op.drop_table("learning_contacts")
