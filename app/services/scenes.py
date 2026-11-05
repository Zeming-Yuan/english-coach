"""Bounded three-turn text tasks; frozen rules are authoritative, never FSRS."""

from __future__ import annotations

import hashlib
import json
import re
from datetime import UTC
from pathlib import Path
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.card import Card
from app.models.lesson import Lesson
from app.models.practice import PracticeItem, PracticeSession
from app.runtime import Runtime, SystemClock
from app.services.content_revisions import get_content_revision
from app.services.practice import (
    PracticeConflictError,
    PracticeNotFoundError,
    PracticeStaleError,
)
from app.services.write_transaction import run_write

SCENE_RULE_FILES = {
    "drinks": {"drinks-v1": "drinks.json"},
    "introduction": {
        "introduction-v1": "introduction-v1.json",
        "introduction-v2": "introduction-v2.json",
        "introduction-v3": "introduction-v3.json",
        "introduction-v4": "introduction.json",
    },
    "directions": {"directions-v1": "directions.json"},
}


def scene_rules(scene_id: str | None, rule_version: str | None = None) -> dict:
    """Latest registered version by default; old material stays registered for V3."""
    versions = SCENE_RULE_FILES.get(scene_id or "")
    if not versions:
        raise PracticeNotFoundError("场景不存在")
    version = rule_version or next(reversed(versions))
    if version not in versions:
        raise PracticeNotFoundError("场景规则版本未登记")
    data = json.loads(
        (Path(__file__).parents[1] / "data/scenes" / versions[version]).read_text()
    )
    _validate_material(data, scene_id, version)
    data["content_hash"] = hashlib.sha256(
        json.dumps(data, sort_keys=True).encode()
    ).hexdigest()
    return data


def _validate_material(data: dict, scene_id: str | None, version: str) -> None:
    """Reject broken distributed rules before they can create persistent tasks."""
    try:
        tasks = data["tasks"]
        valid = (
            data["scene_id"] == scene_id
            and data["rule_version"] == version
            and type(data["content_revision"]) is int
            and data["content_revision"] > 0
            and len(tasks) == 3
            and len({t["task_key"] for t in tasks}) == 3
        )
        for task in tasks:
            valid = valid and all(
                isinstance(task[field], str) and task[field].strip()
                for field in (
                    "task_key",
                    "goal",
                    "role",
                    "hint",
                    "standard",
                    "correction",
                )
            )
            valid = (
                valid
                and isinstance(task["target_words"], list)
                and all(
                    isinstance(word, str) and re.fullmatch(r"[a-z]+", word)
                    for word in task["target_words"]
                )
            )
            if not task["patterns"] or not isinstance(task["rejected"], list):
                valid = False
            if "slot" in task and (
                not isinstance(task["slot"], dict)
                or not isinstance(task["slot"].get("excluded_words"), list)
                or not all(
                    isinstance(word, str) for word in task["slot"]["excluded_words"]
                )
            ):
                raise ValueError("场景材料 slot 规则无效")
            for pattern in task["patterns"]:
                compiled = re.compile(pattern)
                if "slot" in task and "slot" not in compiled.groupindex:
                    valid = False
            if (
                judge(task, task["standard"]) != "accepted"
                or judge(task, task["role"]) == "accepted"
                or normalize_answer(task["standard"]) in normalize_answer(task["role"])
            ):
                valid = False
        if not valid:
            raise ValueError("场景材料身份、三个任务、目标映射或模板无效")
    except (KeyError, TypeError, re.error) as error:
        raise ValueError("场景材料结构或表达规则无效") from error


def scene_tasks(scene_id: str) -> list[str]:
    """Return the registered task keys; unknown scenes use the shared 404 error."""
    return [task["task_key"] for task in scene_rules(scene_id)["tasks"]]


def scene_status(rows: list[dict]) -> str:
    if len(rows) != 3 or any(not row.get("processed", False) for row in rows):
        return "incomplete"
    if all(
        row.get("verdict") == "accepted"
        and not row.get("assistance")
        and not row.get("skipped", False)
        for row in rows
    ):
        return "independent"
    return "completed"


def _teaching_examples(db: Session) -> list[str]:
    cards = list(db.scalars(select(Card)))
    examples = [c.example for c in cards if c.example]
    examples.extend(
        context["en"]
        for card in cards
        for context in (card.contexts or [])
        if isinstance(context, dict) and isinstance(context.get("en"), str)
    )
    for lesson in db.scalars(select(Lesson)):
        content = lesson.content or {}
        examples.extend(
            w["example"] for w in content.get("words", []) if w.get("example")
        )
        examples.extend(d["en"] for d in content.get("dialogue", []) if d.get("en"))
    # A standard expression revealed in an earlier scene is also teaching,
    # even if the learner explicitly opens a new round afterward.
    for item, practice in db.execute(
        select(PracticeItem, PracticeSession)
        .join(PracticeSession, PracticeItem.session_id == PracticeSession.session_id)
        .where(PracticeSession.purpose == "scene")
    ):
        if set(item.assistance or []) & {"answer_visible", "answer_audio"}:
            rules = practice.scene_snapshot or {}
            examples.append(rules["tasks"][item.position - 1]["standard"])
    return sorted(set(examples))


def create_scene(
    db: Session,
    session_id: str,
    scene_id: str | None,
    runtime: Runtime,
    enabled: bool = True,
) -> dict:
    def operation(session: Session):
        existing = session.scalar(
            select(PracticeSession).where(PracticeSession.session_id == session_id)
        )
        if existing is not None:
            if existing.purpose != "scene" or existing.scene_id != scene_id:
                raise PracticeConflictError("该轮次标识已用于其他用途")
            return scene_payload(session, existing, runtime)
        if not enabled:
            raise PermissionError("场景启动入口已关闭；已有记录仍可读取和恢复")
        rules = scene_rules(scene_id)
        now = runtime.clock.now().astimezone(UTC).replace(tzinfo=None)
        practice = PracticeSession(
            session_id=session_id,
            purpose="scene",
            scene_id=scene_id,
            scene_snapshot=rules,
            feedback_epoch=str(uuid4()),
            status="active",
            rule_version=rules["rule_version"],
            pending_contact_ids=[],
            created_at=now,
        )
        session.add(practice)
        session.flush()
        examples = _teaching_examples(session)
        cards = list(
            session.scalars(select(Card).where(Card.kind == "word").order_by(Card.id))
        )
        for position, task in enumerate(rules["tasks"], 1):
            targets = []
            for card in cards:
                if card.word.lower() in task["target_words"]:
                    revision = get_content_revision(session, "card", card.id)
                    targets.append(
                        {
                            **revision,
                            "word": card.word.lower(),
                            "teaching_examples": examples,
                        }
                    )
            session.add(
                PracticeItem(
                    session_id=session_id,
                    item_id=str(uuid4()),
                    position=position,
                    card_id=None,
                    card_identity=None,
                    card_revision=None,
                    kind="scene_text",
                    prompt=task["goal"],
                    question={"task_key": task["task_key"], "target_mapping": targets},
                    assistance=[],
                    created_at=now,
                )
            )
        session.flush()
        return scene_payload(session, practice, runtime)

    return run_write(db, operation)


def scene_payload(
    db: Session, practice: PracticeSession, runtime: Runtime | None = None
) -> dict:
    rules = practice.scene_snapshot
    assert rules is not None
    items = list(
        db.scalars(
            select(PracticeItem)
            .where(PracticeItem.session_id == practice.session_id)
            .order_by(PracticeItem.position)
        )
    )
    from app.models.scene_attempt import SceneAttempt

    attempts = {
        a.attempt_id: a
        for a in db.scalars(
            select(SceneAttempt).where(SceneAttempt.session_id == practice.session_id)
        )
    }
    from app.models.scene_feedback import SceneFeedback
    from app.services.scene_feedback import feedback_payload

    feedback = {
        row.item_id: feedback_payload(row)
        for row in db.scalars(
            select(SceneFeedback).where(SceneFeedback.session_id == practice.session_id)
        )
    }
    out = []
    for item in items:
        task = rules["tasks"][item.position - 1]
        row = (
            attempts.get(item.first_task_attempt_id)
            if item.first_task_attempt_id
            else None
        )
        view = {
            "id": item.item_id,
            "kind": item.kind,
            "position": item.position,
            "task_key": task["task_key"],
            "prompt": item.prompt,
            "role": task["role"],
            "assistance": row.assistance if row else item.assistance,
            "status": "saved" if row else "pending",
            "processed": row is not None,
            "verdict": row.verdict if row else None,
            "skipped": row.skipped if row else False,
        }
        if row:
            view.update(
                answer=row.answer,
                attempt_id=row.attempt_id,
                target_mapping=row.target_mapping,
                correction=task["correction"] if row.verdict == "rejected" else None,
            )
        if item.item_id in feedback:
            view["feedback"] = feedback[item.item_id]
        if "hint" in item.assistance:
            view["hint"] = task["hint"]
        if set(item.assistance) & {"answer_visible", "answer_audio"}:
            view["standard"] = task["standard"]
        out.append(view)
    message = None
    try:
        if items:
            check_scene_current(db, practice, items[0])
    except (PracticeNotFoundError, PracticeStaleError) as error:
        message = str(error)
    return {
        "application_verified": (
            runtime is None or _scene_evidence_enabled(runtime, practice.scene_id)
        )
        and message is None
        and scene_status(out) == "independent"
        and any(t["novel"] for i in out for t in i.get("target_mapping", [])),
        "message": message,
        "can_continue": message is None,
        "creation_enabled": runtime is None
        or _scene_evidence_enabled(runtime, practice.scene_id),
        "id": practice.session_id,
        "purpose": "scene",
        "scene_id": practice.scene_id,
        "title": rules["title"],
        "situation": rules.get("situation", "向店员购买一杯水。"),
        "speaker": rules.get("speaker", "店员"),
        "task_goal": [t["goal"] for t in rules["tasks"]],
        "rule_version": practice.rule_version,
        "content_revision": rules["content_revision"],
        "content_hash": rules["content_hash"],
        "status": scene_status(out),
        "lifecycle": practice.status,
        "items": out,
        "counts": {"total": len(items), "processed": sum(i["processed"] for i in out)},
        "preparation": scene_preparation(db, runtime or Runtime(SystemClock()), rules),
    }


def normalize_answer(answer: str | None) -> str:
    import re

    return re.sub(
        r"[\s,.!?，。！？]+", " ", (answer or "").lower().replace("’", "'")
    ).strip()


def judge(task: dict, answer: str | None, skipped: bool = False) -> str:
    import re

    if skipped:
        return "unknown"
    text = normalize_answer(answer)
    for pattern in task["patterns"]:
        match = re.fullmatch(pattern, text)
        if match:
            if "slot" in task:
                slot = match.group("slot")
                words = set(slot.split())
                if task["slot"].get("check_grammar_tokens"):
                    # Versioned: historical rules retain their original verdict.
                    if re.search(r"['’ʼ＇](?:m|re|ve|ll|d|s|t)\b", slot):
                        continue
                    words.update(re.findall(r"[^\W\d_]+", slot))
                if words & set(task["slot"]["excluded_words"]):
                    continue
            return "accepted"
    return "rejected" if text in task["rejected"] else "unknown"


def check_scene_current(
    db: Session, practice: PracticeSession, item: PracticeItem
) -> None:
    from app.models.content_revision import ContentRevision
    from app.services.practice import PracticeStaleError

    rules = scene_rules(practice.scene_id)
    if rules["content_hash"] != (practice.scene_snapshot or {}).get("content_hash"):
        raise PracticeStaleError("场景规则已修订，请新开一轮；历史结果仍可读取")
    targets = [
        target
        for row in db.scalars(
            select(PracticeItem).where(PracticeItem.session_id == practice.session_id)
        )
        for target in (row.question or {})["target_mapping"]
    ]
    for target in targets:
        revision = db.scalar(
            select(ContentRevision).where(
                ContentRevision.resource_kind == "card",
                ContentRevision.identity == target["identity"],
            )
        )
        if revision is None:
            raise PracticeNotFoundError("目标词已删除，请新开一轮；历史结果仍可读取")
        if revision.version != target["version"]:
            raise PracticeStaleError("目标内容已修订，请新开一轮；历史结果仍可读取")


def scene_help(
    db: Session,
    practice: PracticeSession,
    item: PracticeItem,
    kind: str,
    runtime: Runtime,
) -> dict:
    from app.services.practice import PracticeUnavailableError

    if kind not in ("hint", "answer_visible", "answer_audio"):
        raise PracticeUnavailableError("场景仅支持任务提示或标准表达")
    check_scene_current(db, practice, item)
    # Help requested after the first response only assists subsequent practice.
    item.assistance = sorted(set(item.assistance or []) | {kind})
    db.flush()
    return scene_payload(db, practice, runtime)


def scene_command(
    session_id: str,
    item_id: str,
    answer: str | None,
    skipped: bool,
    client_assistance: list,
) -> dict:
    return {
        "session_id": session_id,
        "item_id": item_id,
        "answer": None if skipped else answer,
        "skipped": skipped,
        "client_assistance": sorted(set(client_assistance)),
    }


def command_fingerprint(command: dict) -> str:
    return hashlib.sha256(
        json.dumps(command, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()


def submit_scene(
    db: Session,
    practice: PracticeSession,
    item: PracticeItem,
    payload,
    runtime: Runtime,
) -> dict:
    """Called inside practice's single write transaction; replay precedes invalidation."""
    from app.models.review_event import ReviewEvent
    from app.models.scene_attempt import SceneAttempt
    from app.services.practice import PracticeUnavailableError

    command = scene_command(
        practice.session_id,
        item.item_id,
        payload.answer,
        payload.skipped,
        payload.client_assistance,
    )
    fingerprint = command_fingerprint(command)
    existing = db.scalar(
        select(SceneAttempt).where(
            SceneAttempt.submission_id == str(payload.submission_id)
        )
    )
    if existing is not None:
        if existing.fingerprint != fingerprint:
            raise PracticeConflictError("该提交标识已用于不同场景答案")
        return existing.response
    if db.scalar(
        select(ReviewEvent.id).where(
            ReviewEvent.submission_id == str(payload.submission_id)
        )
    ):
        raise PracticeConflictError("该提交标识已用于词卡作答")
    check_scene_current(db, practice, item)
    items = list(
        db.scalars(
            select(PracticeItem)
            .where(PracticeItem.session_id == practice.session_id)
            .order_by(PracticeItem.position)
        )
    )
    if any(
        row.position < item.position and row.first_task_attempt_id is None
        for row in items
    ):
        raise PracticeUnavailableError("请先完成当前轮次")
    rules = practice.scene_snapshot
    assert rules is not None
    task = rules["tasks"][item.position - 1]
    first = item.first_task_attempt_id is None
    assistance = sorted(
        set(item.assistance or [])
        | set(payload.client_assistance)
        | (set() if first else {"retry"})
    )
    examples = _teaching_examples(db)
    targets = [
        {
            **target,
            "teaching_examples": sorted(
                set(target["teaching_examples"]) | set(examples)
            ),
            "novel": novel_task_context(
                task, payload.answer, target["teaching_examples"] + examples
            ),
            "context": rules.get("context", "drinks:water-order"),
        }
        for target in (item.question or {})["target_mapping"]
    ]
    row = SceneAttempt(
        attempt_id=str(uuid4()),
        submission_id=str(payload.submission_id),
        session_id=practice.session_id,
        item_id=item.item_id,
        answer=command["answer"],
        skipped=payload.skipped,
        assistance=assistance,
        verdict=judge(task, payload.answer, payload.skipped),
        task_key=task["task_key"],
        rule_version=practice.rule_version,
        target_mapping=targets,
        fingerprint=fingerprint,
        command_json=command,
        response={},
        occurred_at=runtime.clock.now().astimezone(UTC).replace(tzinfo=None),
    )
    db.add(row)
    db.flush()
    if first:
        item.first_task_attempt_id = row.attempt_id
    db.flush()
    if all(i.first_task_attempt_id for i in items):
        practice.status = "completed"
        practice.completed_at = practice.completed_at or row.occurred_at
    db.flush()
    result = {
        "committed": True,
        "attempt_id": row.attempt_id,
        "verdict": row.verdict,
        "skipped": row.skipped,
        "first_response": first,
        "session": scene_payload(db, practice, runtime),
    }
    row.response = result
    db.flush()
    return result


def application_dimensions(db: Session, revisions: dict, runtime: Runtime) -> dict:
    """Only mapped, novel first responses in independent three-task runs qualify."""
    from app.models.scene_attempt import SceneAttempt

    attempts = list(
        db.scalars(
            select(SceneAttempt).order_by(SceneAttempt.occurred_at, SceneAttempt.id)
        )
    )
    practices = {
        p.session_id: p
        for p in db.scalars(
            select(PracticeSession).where(PracticeSession.purpose == "scene")
        )
    }
    items = list(
        db.scalars(select(PracticeItem).where(PracticeItem.kind == "scene_text"))
    )
    first_ids = {i.first_task_attempt_id for i in items if i.first_task_attempt_id}
    first_by_session = {}
    for attempt in attempts:
        if attempt.attempt_id in first_ids:
            first_by_session.setdefault(attempt.session_id, []).append(attempt)
    result = {}
    for card_id, revision in revisions.items():
        by_context = {}
        for row in attempts:
            if row.attempt_id not in first_ids:
                continue
            targets = [
                t
                for t in row.target_mapping
                if t["identity"] == revision["identity"]
                and t["version"] == revision["version"]
            ]
            if not targets:
                continue
            independent = (
                scene_status(
                    [
                        {
                            "processed": True,
                            "verdict": a.verdict,
                            "assistance": a.assistance,
                            "skipped": a.skipped,
                        }
                        for a in first_by_session[row.session_id]
                    ]
                )
                == "independent"
            )
            success = independent and all(t["novel"] for t in targets)
            failure = (
                row.verdict == "rejected" and not row.assistance and not row.skipped
            )
            if success or failure:
                practice = practices[row.session_id]
                rules = practice.scene_snapshot or {}
                key = (
                    practice.scene_id,
                    practice.rule_version,
                    rules["content_hash"],
                    targets[0]["context"],
                )
                by_context.setdefault(key, []).append((row, success))
        contexts = []
        for (scene_id, version, content_hash, context), relevant in by_context.items():
            successes = [row for row, success in relevant if success]
            last_at = (
                successes[-1].occurred_at.replace(tzinfo=UTC) if successes else None
            )
            historical = (
                not _scene_evidence_enabled(runtime, scene_id)
                or content_hash != scene_rules(scene_id)["content_hash"]
            )
            if historical:
                status = "stale"
            elif not relevant[-1][1]:
                status = "weak"
            elif (
                last_at
                and (runtime.clock.now().astimezone(UTC) - last_at).total_seconds()
                > 30 * 86400
            ):
                status = "stale"
            else:
                status = "verified"
            contexts.append(
                {
                    "scene_id": scene_id,
                    "title": (
                        practices[relevant[-1][0].session_id].scene_snapshot or {}
                    )["title"],
                    "context": context,
                    "rule_version": version,
                    "content_hash": content_hash,
                    **_application_summary(status, len(relevant), last_at),
                }
            )
        # An observed failure belongs to its own context; it cannot erase a
        # different context's success or promote that failure into success.
        status = next(
            (
                status
                for status in ("verified", "weak", "stale")
                if any(c["status"] == status for c in contexts)
            ),
            "insufficient",
        )
        dates = [c["last_verified_at"] for c in contexts if c["last_verified_at"]]
        result[card_id] = {
            **_application_summary(status, sum(c["count"] for c in contexts), None),
            "last_verified_at": max(dates) if dates else None,
            "contexts": contexts,
        }
    return result


def _scene_evidence_enabled(runtime: Runtime, scene_id: str | None) -> bool:
    return runtime.scene_evidence_enabled and (
        scene_id == "drinks" or runtime.scene_expansions_enabled
    )


def _application_summary(status: str, count: int, last_at) -> dict:
    return {
        "status": status,
        "count": count,
        "last_verified_at": last_at.isoformat() if last_at else None,
        "label": {
            "verified": "指定语境应用已有证据",
            "weak": "指定语境仍需巩固",
            "stale": "历史应用证据，待复测",
            "insufficient": "迁移能力尚未验证",
        }[status],
    }


def scene_preparation(db: Session, runtime: Runtime, rules: dict | None = None) -> dict:
    from app.services.learning_evidence import bulk_evidence_summaries

    rules = rules or scene_rules("drinks")
    words = list(
        dict.fromkeys(word for task in rules["tasks"] for word in task["target_words"])
    )
    cards = list(
        db.scalars(
            select(Card)
            .where(Card.kind == "word", Card.word.in_(words))
            .order_by(Card.id)
        )
    )
    summaries = bulk_evidence_summaries(db, [c.id for c in cards], runtime)
    missing = [w for w in words if not any(c.word.lower() == w for c in cards)]
    targets = [
        {
            "word": c.word,
            "meaning": c.meaning,
            "revision": summaries[c.id]["revision"],
            "ready": summaries[c.id]["recall"]["status"] == "verified",
        }
        for c in cards
    ]
    ready = not missing and all(t["ready"] for t in targets)
    return {
        "targets": targets,
        "missing_words": missing,
        "ready": ready,
        "message": "已有独立回忆依据，仍需实际任务验证"
        if ready
        else "准备依据不足，可先学目标词或继续挑战",
    }


def novel_task_context(task: dict, answer: str | None, examples: list[str]) -> bool:
    """Exact copies and taught variants of this same task do not prove transfer."""
    return not any(
        normalize_answer(answer) == normalize_answer(example)
        or judge(task, example) == "accepted"
        for example in examples
    )
