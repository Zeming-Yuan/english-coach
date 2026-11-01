"""Add current content revisions for editable entities.

Revision ID: el01_content_revisions
Revises: b1c2d3e4f503
"""

from uuid import uuid4

import sqlalchemy as sa

from alembic import op

revision = "el01_content_revisions"
down_revision = "b1c2d3e4f503"
branch_labels = None
depends_on = None


def _backfill(table: str, resource_kind: str) -> None:
    connection = op.get_bind()
    ids = connection.exec_driver_sql(f"SELECT id FROM {table}").scalars().all()
    if not ids:
        return
    connection.execute(
        sa.text(
            "INSERT INTO content_revisions "
            "(resource_kind, resource_id, identity, version) "
            "VALUES (:kind, :resource_id, :identity, 1)"
        ),
        [
            {
                "kind": resource_kind,
                "resource_id": resource_id,
                "identity": str(uuid4()),
            }
            for resource_id in ids
        ],
    )


def upgrade() -> None:
    op.create_table(
        "content_revisions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("resource_kind", sa.String(length=10), nullable=False),
        sa.Column("resource_id", sa.Integer(), nullable=False),
        sa.Column("identity", sa.String(length=36), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.UniqueConstraint(
            "resource_kind", "resource_id", name="uq_content_revisions_resource"
        ),
    )
    # Existing content gets a current identity only; no historical events or
    # inferred evidence are manufactured by the upgrade.
    _backfill("cards", "card")
    _backfill("lessons", "lesson")
    _backfill("stories", "story")


def downgrade() -> None:
    op.drop_table("content_revisions")
