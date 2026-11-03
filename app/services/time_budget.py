"""Workload estimates only; never scoring or scheduling inputs."""

from math import isfinite
from statistics import median

DEFAULT_SECONDS = {"review": 20, "new": 40, "reinforcement": 20}


def estimate_seconds(samples: list[float], default: float) -> float:
    valid = [min(180.0, max(2.0, v)) for v in samples if isfinite(v) and v >= 0]
    return float(median(valid[-30:])) if len(valid) >= 5 else default


def workload_estimates(db, enabled=True) -> dict:
    from sqlalchemy import select

    from app.models.practice_duration import PracticeDuration
    from app.schemas.duration import DURATION_RULE

    estimates = {}
    for kind, default in DEFAULT_SECONDS.items():
        samples = (
            list(
                db.scalars(
                    select(PracticeDuration.active_ms)
                    .where(
                        PracticeDuration.kind == kind,
                        PracticeDuration.rule_version == DURATION_RULE,
                    )
                    .order_by(PracticeDuration.id.desc())
                    .limit(30)
                )
            )
            if enabled
            else []
        )
        personal = len(samples) >= 5
        estimates[kind] = {
            "seconds": estimate_seconds([v / 1000 for v in reversed(samples)], default),
            "basis": "personal" if personal else "default",
            "sample_count": len(samples),
        }
    return estimates


def recovery_available(inactive_days: int, due_count: int) -> bool:
    return inactive_days >= 3 and due_count > 0


def budget_plan(
    due: list[dict],
    new: list[dict],
    minutes: int,
    new_remaining: int,
    *,
    review_limit: int = 20,
    estimates: dict | None = None,
    mode: str = "regular",
) -> dict:
    if minutes not in (3, 8, 15):
        raise ValueError("budget must be 3, 8 or 15")
    if mode == "recovery":
        review_limit = min(5, review_limit)
        new_remaining = 0
    estimates = estimates or {
        kind: {"seconds": seconds, "basis": "default", "sample_count": 0}
        for kind, seconds in DEFAULT_SECONDS.items()
    }
    review_seconds, new_seconds, reinforcement_seconds = (
        estimates[kind]["seconds"] for kind in DEFAULT_SECONDS
    )
    allowance = max(0, minutes * 60 - 15 - 3 * reinforcement_seconds)
    reviews = due[: min(20, max(0, review_limit), int(allowance // review_seconds))]
    if not reviews and due and review_limit > 0:
        reviews = due[:1]
    remaining = len(due) - len(reviews)
    room = max(0, allowance - len(reviews) * review_seconds)
    fresh = (
        [] if remaining else new[: min(max(0, new_remaining), int(room // new_seconds))]
    )
    if not reviews and not remaining and not fresh and new_remaining > 0:
        fresh = new[:1]
    target = len(reviews) + len(fresh)
    reinforcement_limit = min(3, target)
    estimated = (
        (
            15
            + len(reviews) * review_seconds
            + len(fresh) * new_seconds
            + reinforcement_limit * reinforcement_seconds
        )
        if target
        else 0
    )
    return {
        "queue": reviews + fresh,
        "review_count": len(reviews),
        "new_count": len(fresh),
        "remaining_due": remaining,
        "target": target,
        "plan": {
            "budget_minutes": minutes,
            "estimated_seconds": estimated,
            "may_exceed_budget": estimated > minutes * 60,
            "estimate_basis": "personal"
            if any(value["basis"] == "personal" for value in estimates.values())
            else "default",
            "estimates": estimates,
            "mode": mode,
            "reinforcement_limit": reinforcement_limit,
        },
    }
