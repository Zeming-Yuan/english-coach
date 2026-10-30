"""统一学习提交模块：判分、追加事件、FSRS、错词与幂等回放。

所有写入入口最终汇聚到 submit_attempt / apply_attempt_in_transaction：
- 路由不在进入写模块前查询数据库；
- run_write 持有 BEGIN IMMEDIATE，事件、排期、错词同一事务提交；
- submission_id 唯一；同标识同内容返回缓存，不同内容返回 409；
- 旧调用自动生成随机 submission_id，不承诺跨请求幂等。
"""

from __future__ import annotations

import contextvars
import hashlib
import json
import threading
from datetime import datetime, timezone
from uuid import uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import literal_column, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.card import Card
from app.models.review import Review
from app.models.review_baseline import ReviewBaseline
from app.models.review_event import ReviewEvent
from app.runtime import Runtime
from app.schemas.learning import AttemptCommand, AttemptResult
from app.services.error_tracking import record_error
from app.services.graduation import (
    ensure_sentence_card,
    is_graduated,
    upgrade_sentence_card,
)
from app.services.scheduler import build_fsrs_card, schedule
from app.services.scoring import normalize
from app.services.write_transaction import run_write

UPGRADE_INFO_KEY = "learning:upgrade_card_id"


class CardNotFoundError(LookupError):
    """卡不存在（端点映射 404）。"""


class SubmissionConflictError(RuntimeError):
    """同一提交标识已用于不同内容（端点映射 409）。"""

    def __init__(self, submission_id: str):
        super().__init__(f"submission_id 已用于其他内容：{submission_id}")
        self.submission_id = submission_id


def _utc_iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def _command_payload(
    cmd: AttemptCommand, verified_question: dict | None = None
) -> dict:
    """指纹与 command_json 共用的规范化业务字段（不含服务端时间/随机 ID）。"""
    return {
        "card_id": cmd.card_id,
        "source": cmd.source,
        "kind": cmd.kind,
        "answer": cmd.answer,
        "rating": cmd.rating,
        "assistance": sorted(cmd.assistance),
        "skipped": cmd.skipped,
        "stage": cmd.stage,
        "session_id": str(cmd.session_id) if cmd.session_id else None,
        "question": verified_question,
    }


def canonical_attempt(
    cmd: AttemptCommand, *, verified_question: dict | None = None
) -> str:
    """对验证后的业务内容排序 JSON 取 SHA256；不含时间、event_id 与题目签名。"""
    payload = _command_payload(cmd, verified_question)
    encoded = json.dumps(
        payload,
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
        default=str,
    )
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def classify_attempt(cmd: AttemptCommand, expected: str) -> tuple[bool | None, int | None]:
    """返回 (客观正误, 实际采用的 FSRS 评分)。

    - 跳过：均为空，不伪造答错；
    - 自评：正误为空，评分用用户选择；
    - 无辅助的 typed：答对 3 / 答错 1；带辅助、选择题不排期；
    - legacy 未分类事件不进入可靠指标，typed 也不排期。
    """
    if cmd.skipped:
        return None, None
    if cmd.kind == "self_rating":
        return None, cmd.rating
    correct = normalize(cmd.answer or "") == normalize(expected)
    if (
        cmd.kind == "typed"
        and not cmd.assistance
        and cmd.source != "legacy"
    ):
        return correct, 3 if correct else 1
    return correct, None


def get_memory_state(db: Session, card_id: int) -> Review | None:
    """选择当前记忆状态：最新有效复习时间，再按记录顺序（id）。

    兼容旧库同卡多行；迁移基线与运行期读取使用同一规则。
    """
    return (
        db.execute(
            select(Review)
            .where(Review.card_id == card_id)
            .order_by(
                Review.last_review.is_(None),
                Review.last_review.desc(),
                Review.id.desc(),
            )
        )
        .scalars()
        .first()
    )


def _event_payload(event: ReviewEvent) -> dict:
    return {
        "event_id": event.id,
        "card_id": event.card_id,
        "source": event.source,
        "kind": event.kind,
        "stage": event.stage,
        "occurred_at": _utc_iso(event.occurred_at),
        "learning_day": event.learning_day,
        "learning_timezone": event.learning_timezone,
        "answer": event.answer,
        "correct": event.correct,
        "skipped": event.skipped,
        "scheduled": event.scheduled,
        "assistance": list(event.assistance or []),
        "self_rating": event.self_rating,
        "fsrs_rating": event.fsrs_rating,
        "before": event.before,
        "after": event.after,
        "session_id": event.session_id,
    }


def get_card_events(db: Session, card_id: int) -> list[dict]:
    """按提交先后返回真实事件；不包含迁移基线。"""
    events = (
        db.execute(
            select(ReviewEvent)
            .where(ReviewEvent.card_id == card_id)
            .order_by(
                ReviewEvent.occurred_at.asc(),
                literal_column("review_events.rowid").asc(),
            )
        )
        .scalars()
        .all()
    )
    return [_event_payload(event) for event in events]


def has_incomplete_history(db: Session, card_id: int) -> bool:
    """有迁移基线或未分类旧事件时，历史不能被当作完整逐次记录。"""
    baseline = db.execute(
        select(ReviewBaseline.id).where(ReviewBaseline.card_id == card_id).limit(1)
    ).first()
    if baseline is not None:
        return True
    legacy = db.execute(
        select(ReviewEvent.id)
        .where(ReviewEvent.card_id == card_id, ReviewEvent.source == "legacy")
        .limit(1)
    ).first()
    return legacy is not None


def _memory_summary(fsrs_card) -> dict:
    return {
        "state": int(fsrs_card.state),
        "step": fsrs_card.step,
        "due": _utc_iso(fsrs_card.due),
        "stability": fsrs_card.stability,
        "difficulty": fsrs_card.difficulty,
        "last_review": _utc_iso(fsrs_card.last_review),
    }


def _apply_attempt_in_transaction(
    db: Session,
    cmd: AttemptCommand,
    runtime: Runtime,
    *,
    verified_question: dict | None = None,
    correct_override: bool | None = None,
) -> AttemptResult:
    db.info.pop(UPGRADE_INFO_KEY, None)
    if cmd.submission_id is None:
        cmd = cmd.model_copy(update={"submission_id": uuid4()})
    submission_id = str(cmd.submission_id)
    fingerprint = canonical_attempt(cmd, verified_question=verified_question)

    existing = (
        db.execute(
            select(ReviewEvent).where(ReviewEvent.submission_id == submission_id)
        )
        .scalars()
        .first()
    )
    if existing is not None:
        if existing.fingerprint != fingerprint:
            raise SubmissionConflictError(submission_id)
        return AttemptResult.model_validate(existing.response)

    card = db.get(Card, cmd.card_id)
    if card is None:
        raise CardNotFoundError(cmd.card_id)

    expected: str | None = None
    if cmd.kind != "self_rating":
        if verified_question and verified_question.get("expected") is not None:
            expected = str(verified_question["expected"])
        elif card.kind == "word":
            expected = card.word
        else:
            expected = card.example or card.word

    correct, fsrs_rating = classify_attempt(cmd, expected or "")
    if correct_override is not None:
        correct = correct_override

    now = runtime.clock.now().astimezone(timezone.utc)
    learning_day = now.astimezone(ZoneInfo(runtime.learning_timezone)).date().isoformat()

    review = get_memory_state(db, card.id)
    fsrs_card = build_fsrs_card(review)
    before = _memory_summary(fsrs_card)
    scheduled = fsrs_rating is not None and not cmd.skipped
    after = before
    next_due = _utc_iso(review.due) if review is not None else None

    if scheduled:
        new_card = schedule(fsrs_card, fsrs_rating, now)
        after = _memory_summary(new_card)
        if review is None:
            review = Review(card_id=card.id, review_count=1)
            db.add(review)
        else:
            review.review_count += 1
        review.state = new_card.state.value
        review.step = new_card.step
        review.due = new_card.due
        review.stability = new_card.stability  # type: ignore[assignment]
        review.difficulty = new_card.difficulty  # type: ignore[assignment]
        review.elapsed_days = (
            (now - review.last_review.replace(tzinfo=timezone.utc)).days
            if review.last_review
            else 0
        )
        review.last_review = now
        review.rating = fsrs_rating
        next_due = _utc_iso(new_card.due)

    if not cmd.skipped:
        if correct_override is not None:
            is_correct = correct_override
        elif correct is not None:
            is_correct = correct
        else:
            is_correct = (fsrs_rating or cmd.rating or 0) >= 3
        record_error(db, card.id, is_correct=is_correct)

    graduated = False
    sentence_card_id = None
    graduated_now = (
        scheduled and card.kind == "word" and review is not None and is_graduated(review)
    )
    if graduated_now:
        sentence = ensure_sentence_card(card, db)
        if sentence is not None:
            graduated = True
            sentence_card_id = sentence.id

    event_id = str(uuid4())
    result = AttemptResult(
        event_id=event_id,
        card_id=card.id,
        correct=correct,
        expected=normalize(expected) if expected is not None else None,
        scheduled=scheduled,
        next_due=next_due,
        graduated=graduated,
        sentence_card_id=sentence_card_id,
    )
    command_json = {
        **_command_payload(cmd, verified_question),
        "submission_id": submission_id,
        "question_token": cmd.question_token,
    }
    command_json["expected"] = expected
    db.add(
        ReviewEvent(
            id=event_id,
            submission_id=submission_id,
            card_id=card.id,
            source=cmd.source,
            kind=cmd.kind,
            stage=cmd.stage,
            occurred_at=now.replace(tzinfo=None),
            learning_day=learning_day,
            learning_timezone=runtime.learning_timezone,
            answer=cmd.answer,
            correct=correct,
            skipped=cmd.skipped,
            scheduled=scheduled,
            assistance=list(cmd.assistance),
            self_rating=cmd.rating if cmd.kind == "self_rating" else None,
            fsrs_rating=fsrs_rating if scheduled else None,
            before=before if scheduled else None,
            after=after if scheduled else None,
            fingerprint=fingerprint,
            command_json=command_json,
            response=result.model_dump(),
            session_id=str(cmd.session_id) if cmd.session_id else None,
        )
    )
    db.flush()
    if graduated_now:
        db.info[UPGRADE_INFO_KEY] = card.id
    return result


def apply_attempt_in_transaction(
    db: Session,
    cmd: AttemptCommand,
    runtime: Runtime,
    *,
    verified_question: dict | None = None,
) -> AttemptResult:
    """由已在 run_write 内的调用者使用；不自行 commit，避免嵌套事务。"""
    return _apply_attempt_in_transaction(
        db, cmd, runtime, verified_question=verified_question
    )


def submit_attempt(
    db: Session,
    cmd: AttemptCommand,
    runtime: Runtime,
    *,
    correct_override: bool | None = None,
    upgrade=None,
) -> AttemptResult:
    """唯一原子业务入口：幂等回放/409、404、判分、事件、排期与错词。"""
    if cmd.submission_id is None:
        cmd = cmd.model_copy(update={"submission_id": uuid4()})
    fingerprint = canonical_attempt(cmd)
    try:
        result = run_write(
            db,
            lambda session: _apply_attempt_in_transaction(
                session, cmd, runtime, correct_override=correct_override
            ),
        )
    except IntegrityError:
        # 并发同标识提交：唯一约束挡住后回读已保存结果
        existing = (
            db.execute(
                select(ReviewEvent).where(
                    ReviewEvent.submission_id == str(cmd.submission_id)
                )
            )
            .scalars()
            .first()
        )
        if existing is None or existing.fingerprint != fingerprint:
            raise
        result = AttemptResult.model_validate(existing.response)

    upgrade_card_id = db.info.pop(UPGRADE_INFO_KEY, None)
    if upgrade_card_id is not None:
        # commit 之后才启动 AI；后台线程沿用本应用实例的 LLM 绑定。
        target = upgrade or upgrade_sentence_card
        ctx = contextvars.copy_context()
        threading.Thread(target=ctx.run, args=(target, upgrade_card_id), daemon=True).start()
    return result
