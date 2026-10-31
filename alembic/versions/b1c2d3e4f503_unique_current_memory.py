"""Enforce one current memory state without removing learning history."""

import hashlib
import json
import math
from datetime import UTC, datetime
from uuid import uuid4

import sqlalchemy as sa

from alembic import op

revision = "b1c2d3e4f503"
down_revision = "ec12_card_identity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    reviews = sa.Table("reviews", sa.MetaData(), autoload_with=bind)
    baselines = sa.Table("review_baselines", sa.MetaData(), autoload_with=bind)
    # Reflect and validate the complete input before modifying any row. No ORM
    # imports: migration semantics must survive later product refactors.
    grouped = {}
    try:
        rows = [dict(row) for row in bind.execute(sa.select(reviews)).mappings()]
    except (ValueError, TypeError) as error:
        raise RuntimeError(
            "reviews contains invalid legacy timestamps; repair before contract"
        ) from error
    for row in rows:
        for field in ("review_count", "elapsed_days", "step"):
            if field == "step" and row[field] is None:
                continue
            if not isinstance(row[field], int) or row[field] < 0:
                raise RuntimeError(
                    f"reviews row {row['id']} has invalid {field}; repair before contract"
                )
        for field in ("stability", "difficulty"):
            if (
                not isinstance(row[field], (int, float))
                or not math.isfinite(row[field])
                or row[field] < 0
                or (field == "difficulty" and row[field] > 10)
            ):
                raise RuntimeError(
                    f"reviews row {row['id']} has invalid {field}; repair before contract"
                )
        if row["state"] not in (0, 1, 2, 3) or row["rating"] not in (None, 1, 2, 3, 4):
            raise RuntimeError(
                f"reviews row {row['id']} has invalid state/rating; repair before contract"
            )
        grouped.setdefault(row["card_id"], []).append(dict(row))
    existing = set(bind.execute(sa.select(baselines.c.source_fingerprint)).scalars())
    archives, discarded = [], []
    for card_id, rows in grouped.items():
        if len(rows) < 2:
            continue
        selected = max(
            rows,
            key=lambda row: (
                row["last_review"] is not None,
                row["last_review"] or datetime.min,
                row["id"],
            ),
        )
        for row in rows:
            raw = {
                key: value.isoformat() if isinstance(value, datetime) else value
                for key, value in row.items()
            }
            encoded = json.dumps(
                raw, sort_keys=True, ensure_ascii=False, separators=(",", ":")
            )
            fingerprint = hashlib.sha256(encoded.encode("utf-8")).hexdigest()
            if fingerprint not in existing:
                archives.append(
                    {
                        "id": str(uuid4()),
                        "card_id": card_id,
                        "source_review_id": row["id"],
                        "source_kind": "contract_archive",
                        "raw": raw,
                        "selected": row is selected,
                        "captured_at": datetime.now(UTC).replace(tzinfo=None),
                        "last_activity": row["last_review"],
                        "cumulative_count": max(0, int(row["review_count"])),
                        "source_fingerprint": fingerprint,
                    }
                )
                existing.add(fingerprint)
            if row is not selected:
                discarded.append(row["id"])
    if archives:
        bind.execute(baselines.insert(), archives)
    if discarded:
        bind.execute(reviews.delete().where(reviews.c.id.in_(discarded)))
    # Index-only DDL deliberately leaves cards/sqlite_sequence untouched.
    op.create_index("uq_reviews_current_card", "reviews", ["card_id"], unique=True)


def downgrade() -> None:
    op.drop_index("uq_reviews_current_card", table_name="reviews")
