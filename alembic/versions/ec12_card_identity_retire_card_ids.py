"""Retire card IDs across empty full restores.

Revision ID: ec12_card_identity
Revises: b1c2d3e4f502
"""

from alembic import op

revision = "ec12_card_identity"
down_revision = "b1c2d3e4f502"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    if connection.dialect.name != "sqlite":
        return
    definition = connection.exec_driver_sql(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='cards'"
    ).scalar_one()
    if "AUTOINCREMENT" not in definition.upper():
        # The project's SQLite migration connection uses its default FK mode;
        # don't alter PRAGMA foreign_keys or lose incoming references. Batch copy
        # preserves all IDs/columns/indexes, then verify the entire graph.
        with op.batch_alter_table(
            "cards", recreate="always", table_kwargs={"sqlite_autoincrement": True}
        ):
            pass
    if connection.exec_driver_sql("PRAGMA foreign_key_check").fetchone() is not None:
        raise RuntimeError("Card identity migration found invalid foreign keys")


def downgrade() -> None:
    # Additive allocator metadata is deliberately retained, including high-water
    # state when cards is empty. Old restore writers explicitly assigning IDs can
    # bypass it; a version rollback cannot promise the stale-work protection.
    pass
