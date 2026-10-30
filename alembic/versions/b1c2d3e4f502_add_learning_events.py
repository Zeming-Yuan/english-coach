"""add learning events and legacy review baselines

Revision ID: b1c2d3e4f502
Revises: b1c2d3e4f501
Create Date: 2026-10-30 00:00:01.000000

旧 Review 行只作为迁移基线保存原始快照，不按 review_count 伪造历史事件。
同卡多行按「最新有效复习时间，再按记录顺序」选出当前状态来源行。
"""

import hashlib
import json
import uuid
from collections.abc import Sequence
from datetime import datetime, timezone

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b1c2d3e4f502"
down_revision: str | Sequence[str] | None = "b1c2d3e4f501"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _jsonable(row: dict) -> dict:
    payload = {}
    for key, value in row.items():
        payload[key] = value.isoformat() if isinstance(value, datetime) else value
    return payload


def _fingerprint(payload: dict) -> str:
    encoded = json.dumps(
        payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=str
    )
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _capture_legacy_baselines() -> None:
    bind = op.get_bind()
    reviews = sa.Table("reviews", sa.MetaData(), autoload_with=bind)
    rows = [dict(row) for row in bind.execute(sa.select(reviews)).mappings()]
    if not rows:
        return

    grouped: dict[int, list[dict]] = {}
    for row in rows:
        grouped.setdefault(row["card_id"], []).append(row)

    captured_at = datetime.now(timezone.utc).replace(tzinfo=None)
    baselines = []
    for card_id, group in grouped.items():
        selected = max(
            group,
            key=lambda row: (
                row["last_review"] is not None,
                row["last_review"] or datetime.min,  # noqa: DTZ901 — 与数据库内无时区时间比较
                row["id"],
            ),
        )
        for row in group:
            raw = _jsonable(row)
            baselines.append(
                {
                    "id": str(uuid.uuid4()),
                    "card_id": card_id,
                    "source_review_id": row["id"],
                    "source_kind": "migration",
                    "raw": raw,
                    "selected": row is selected,
                    "captured_at": captured_at,
                    "last_activity": row["last_review"],
                    "cumulative_count": max(0, int(row["review_count"] or 0)),
                    "source_fingerprint": _fingerprint(raw),
                }
            )

    baselines_table = sa.table(
        "review_baselines",
        sa.column("id", sa.String(36)),
        sa.column("card_id", sa.Integer()),
        sa.column("source_review_id", sa.Integer()),
        sa.column("source_kind", sa.String(20)),
        sa.column("raw", sa.JSON()),
        sa.column("selected", sa.Boolean()),
        sa.column("captured_at", sa.DateTime()),
        sa.column("last_activity", sa.DateTime()),
        sa.column("cumulative_count", sa.Integer()),
        sa.column("source_fingerprint", sa.String(64)),
    )
    op.bulk_insert(baselines_table, baselines)


def upgrade() -> None:
    op.create_table(
        "review_events",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("submission_id", sa.String(length=36), nullable=False),
        sa.Column("card_id", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(length=20), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column(
            "stage",
            sa.String(length=20),
            nullable=False,
            server_default="standalone",
        ),
        sa.Column("occurred_at", sa.DateTime(), nullable=False),
        sa.Column("learning_day", sa.String(length=10), nullable=False),
        sa.Column("learning_timezone", sa.String(length=64), nullable=False),
        sa.Column("answer", sa.Text(), nullable=True),
        sa.Column("correct", sa.Boolean(), nullable=True),
        sa.Column("skipped", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "scheduled", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column("assistance", sa.JSON(), nullable=False),
        sa.Column("self_rating", sa.Integer(), nullable=True),
        sa.Column("fsrs_rating", sa.Integer(), nullable=True),
        sa.Column("before", sa.JSON(), nullable=True),
        sa.Column("after", sa.JSON(), nullable=True),
        sa.Column("fingerprint", sa.String(length=64), nullable=False),
        sa.Column("command_json", sa.JSON(), nullable=False),
        sa.Column("response", sa.JSON(), nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=True),
        sa.ForeignKeyConstraint(["card_id"], ["cards.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_review_events_submission_id",
        "review_events",
        ["submission_id"],
        unique=True,
    )
    op.create_index("ix_review_events_card_id", "review_events", ["card_id"])
    op.create_index("ix_review_events_occurred_at", "review_events", ["occurred_at"])
    op.create_index("ix_review_events_learning_day", "review_events", ["learning_day"])

    op.create_table(
        "review_baselines",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("card_id", sa.Integer(), nullable=False),
        sa.Column("source_review_id", sa.Integer(), nullable=True),
        sa.Column("source_kind", sa.String(length=20), nullable=False),
        sa.Column("raw", sa.JSON(), nullable=False),
        sa.Column(
            "selected", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column("captured_at", sa.DateTime(), nullable=False),
        sa.Column("last_activity", sa.DateTime(), nullable=True),
        sa.Column("cumulative_count", sa.Integer(), nullable=False),
        sa.Column("source_fingerprint", sa.String(length=64), nullable=False),
        sa.ForeignKeyConstraint(["card_id"], ["cards.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_review_baselines_card_id", "review_baselines", ["card_id"])
    op.create_index(
        "ix_review_baselines_source_fingerprint",
        "review_baselines",
        ["source_fingerprint"],
        unique=True,
    )

    _capture_legacy_baselines()


def downgrade() -> None:
    op.drop_index(
        "ix_review_baselines_source_fingerprint", table_name="review_baselines"
    )
    op.drop_index("ix_review_baselines_card_id", table_name="review_baselines")
    op.drop_table("review_baselines")
    op.drop_index("ix_review_events_learning_day", table_name="review_events")
    op.drop_index("ix_review_events_occurred_at", table_name="review_events")
    op.drop_index("ix_review_events_card_id", table_name="review_events")
    op.drop_index("ix_review_events_submission_id", table_name="review_events")
    op.drop_table("review_events")
