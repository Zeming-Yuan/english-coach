"""Default workload estimates for a bounded daily word-card round."""


def budget_plan(
    due: list[dict],
    new: list[dict],
    minutes: int,
    new_remaining: int,
    *,
    review_limit: int = 20,
) -> dict:
    if minutes not in (3, 8, 15):
        raise ValueError("budget must be 3, 8 or 15")
    allowance = minutes * 60 - 15 - 3 * 20
    reviews = due[: min(20, max(0, review_limit), allowance // 20)]
    remaining = len(due) - len(reviews)
    room = max(0, allowance - len(reviews) * 20)
    fresh = [] if remaining else new[: min(max(0, new_remaining), room // 40)]
    target = len(reviews) + len(fresh)
    reinforcement_limit = min(3, target)
    return {
        "queue": reviews + fresh,
        "review_count": len(reviews),
        "new_count": len(fresh),
        "remaining_due": remaining,
        "target": target,
        "plan": {
            "budget_minutes": minutes,
            "estimated_seconds": 15
            + len(reviews) * 20
            + len(fresh) * 40
            + reinforcement_limit * 20
            if target
            else 0,
            "estimate_basis": "default",
            "mode": "regular",
            "reinforcement_limit": reinforcement_limit,
        },
    }
