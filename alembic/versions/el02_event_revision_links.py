"""Link learning events to the content revision seen at submission time.

Revision ID: el02_event_revision_links
Revises: el01_content_revisions
"""

import sqlalchemy as sa

from alembic import op

revision = "el02_event_revision_links"
down_revision = "el01_content_revisions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Nullable on purpose: existing events stay unlinked instead of being
    # backfilled with an invented revision.
    with op.batch_alter_table("review_events") as batch:
        batch.add_column(sa.Column("card_identity", sa.String(length=36), nullable=True))
        batch.add_column(sa.Column("card_revision", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("review_events") as batch:
        batch.drop_column("card_revision")
        batch.drop_column("card_identity")
