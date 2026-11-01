"""词卡路由：生成词卡 + 单词本列表。"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import ObjectDeletedError

from app.db import get_db
from app.models.card import Card
from app.models.error_card import ErrorCard
from app.models.hard_card import HardCard
from app.models.learning_contact import LearningContact
from app.models.memo import Memo
from app.models.review import Review
from app.models.review_baseline import ReviewBaseline
from app.models.review_event import ReviewEvent
from app.runtime import Runtime, get_runtime
from app.services.card_generator import generate_cards, regenerate_example
from app.services.card_payload import card_payload
from app.services.contacts import contact_summary
from app.services.content_revisions import (
    advance_content_revision,
    content_revision_map,
    delete_content_revision,
    get_content_revision,
)
from app.services.graduation import card_is_graduated
from app.services.learning import (
    get_card_events,
    get_legacy_review_history,
    get_memory_state,
    has_incomplete_history,
    select_current_review,
)
from app.services.learning_evidence import bulk_evidence_summaries, evidence_summary
from app.services.llm_client import LLMNotConfigured
from app.services.starter_cards import load_starter_cards, starter_card_rows
from app.services.write_transaction import run_write

router = APIRouter()


class GenerateCardsIn(BaseModel):
    """生成词卡请求体。"""

    words: list[str] = Field(min_length=1, max_length=20)


class UpdateCardIn(BaseModel):
    """词卡编辑请求体：字段可部分更新。"""

    word: str | None = Field(default=None, min_length=1, max_length=50)
    meaning: str | None = Field(default=None, max_length=500)
    phonetic: str | None = Field(default=None, max_length=50)
    example: str | None = Field(default=None, max_length=500)
    example_cn: str | None = Field(default=None, max_length=500)
    explanation: str | None = Field(default=None, max_length=500)
    contexts: list | None = None


@router.post("/cards/{card_id}/hard")
def toggle_hard(card_id: int, db: Session = Depends(get_db)):
    """切换困难词标记（自主增强：优先重现）。"""
    card = db.get(Card, card_id)
    if card is None:
        raise HTTPException(status_code=404, detail="Card not found")
    row = (
        db.execute(select(HardCard).where(HardCard.card_id == card_id))
        .scalars()
        .first()
    )
    if row:
        db.delete(row)
        db.commit()
        return {"card_id": card_id, "is_hard": False}
    db.add(HardCard(card_id=card_id))
    db.commit()
    return {"card_id": card_id, "is_hard": True}


@router.put("/cards/{card_id}")
def update_card(card_id: int, payload: UpdateCardIn, db: Session = Depends(get_db)):
    """编辑词卡（用户纠正 AI 生成错误）；内容与修订同一事务提交。"""
    data = payload.model_dump(exclude_none=True)

    def operation(session: Session) -> dict:
        card = session.get(Card, card_id)
        if card is None:
            raise HTTPException(status_code=404, detail="Card not found")
        # 必须在赋值前读取旧内容，才能判断这次编辑是否实质变化。
        advance_content_revision(session, "card", card_id, data)
        for field, value in data.items():
            setattr(card, field, value)
        session.flush()
        return card_to_dict(card, session)

    return run_write(db, operation)


@router.delete("/cards/{card_id}")
def delete_card(card_id: int, db: Session = Depends(get_db)):
    """删除词卡（级联清复习/记忆法/错词/故事关联）。"""
    card = db.get(Card, card_id)
    if card is None:
        raise HTTPException(status_code=404, detail="Card not found")
    from app.models.story import StoryWord

    db.execute(Review.__table__.delete().where(Review.card_id == card_id))
    db.execute(ReviewEvent.__table__.delete().where(ReviewEvent.card_id == card_id))
    db.execute(
        ReviewBaseline.__table__.delete().where(ReviewBaseline.card_id == card_id)
    )
    db.execute(
        LearningContact.__table__.delete().where(LearningContact.card_id == card_id)
    )
    delete_content_revision(db, "card", card_id)
    db.execute(Memo.__table__.delete().where(Memo.card_id == card_id))
    db.execute(ErrorCard.__table__.delete().where(ErrorCard.card_id == card_id))
    db.execute(HardCard.__table__.delete().where(HardCard.card_id == card_id))
    db.execute(StoryWord.__table__.delete().where(StoryWord.card_id == card_id))
    db.delete(card)
    db.commit()
    return {"deleted": card_id}


def card_to_dict(card: Card, db: Session) -> dict:
    """Card → 全量载荷（含复习状态；比列表版多 3 次关联查询）。"""
    review = get_memory_state(db, card.id)
    error = (
        db.execute(select(ErrorCard).where(ErrorCard.card_id == card.id))
        .scalars()
        .first()
    )
    hard = (
        db.execute(select(HardCard).where(HardCard.card_id == card.id))
        .scalars()
        .first()
    )
    return card_payload(
        card,
        review=review,
        error=error,
        hard=hard is not None,
        revision=get_content_revision(db, "card", card.id),
    )


def _card_to_dict_fast(
    card: Card,
    review: Review | None,
    error: ErrorCard | None,
    is_hard: bool,
    evidence: dict | None = None,
    revision: dict | None = None,
) -> dict:
    """Card → 全量载荷（批量预加载版本，无额外查询）。"""
    return card_payload(
        card,
        review=review,
        error=error,
        hard=is_hard,
        evidence=evidence,
        revision=revision,
    )


@router.post("/cards/generate")
def generate(req: GenerateCardsIn, db: Session = Depends(get_db)):
    """AI 批量生成词卡（已存在的词跳过）。"""
    try:
        cards = generate_cards(req.words, db)
    except ValueError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {
        "generated": len(cards),
        "skipped": len(req.words) - len(cards),
        "cards": [card_to_dict(c, db) for c in cards],
    }


@router.post("/cards/starter")
def add_starter_cards(db: Session = Depends(get_db)):
    """显式添加内置入门词卡：已存在的单词卡跳过，不改写用户内容。

    存在检查与插入在同一写事务内：SQLite 用 BEGIN IMMEDIATE 串行化并发点击，
    失败整体回滚（EC-03 的统一写事务模块落地后由它接管）。
    """
    rows = starter_card_rows()
    db.execute(text("BEGIN IMMEDIATE"))
    try:
        cards = load_starter_cards(db, rows)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return {
        "generated": len(cards),
        "skipped": len(rows) - len(cards),
        "cards": [card_to_dict(c, db) for c in cards],
    }


@router.post("/cards/{card_id}/regenerate")
def regenerate_card_example(card_id: int, db: Session = Depends(get_db)):
    """换一个例句：重新生成例句/翻译/讲解并更新卡。"""
    card = db.get(Card, card_id)
    if card is None:
        raise HTTPException(status_code=404, detail="Card not found")
    before = get_content_revision(db, "card", card_id)
    try:
        example, example_cn, explanation = regenerate_example(card.word)
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=502, detail=str(e))
    if not example:
        return card_to_dict(card, db)

    def operation(session: Session) -> dict:
        try:
            current = session.get(Card, card_id, populate_existing=True)
        except ObjectDeletedError:
            current = None
        if current is None:
            raise HTTPException(status_code=404, detail="Card not found")
        try:
            current_revision = get_content_revision(session, "card", card_id)
        except LookupError:
            raise HTTPException(status_code=404, detail="Card not found")
        # 晚到生成不覆盖编辑或恢复后的内容；响应必须反映当前内容。
        if current_revision != before:
            return card_to_dict(current, session)
        advance_content_revision(
            session, "card", card_id, {"example": example, "example_cn": example_cn}
        )
        current.example = example
        current.example_cn = example_cn
        current.explanation = explanation
        session.flush()
        return card_to_dict(current, session)

    return run_write(db, operation)


@router.get("/cards")
def list_cards(
    db: Session = Depends(get_db),
    runtime: Runtime = Depends(get_runtime),
):
    """单词本：全库卡片，按创建时间倒序；批量附带当前证据标签。"""
    cards = (
        db.execute(select(Card).order_by(Card.created_at.desc(), Card.id.desc()))
        .scalars()
        .all()
    )
    if not cards:
        return {"cards": []}
    # 批量预加载关联数据，消除 N+1 查询
    card_ids = [c.id for c in cards]
    reviews = (
        db.execute(select(Review).where(Review.card_id.in_(card_ids))).scalars().all()
    )
    errors = (
        db.execute(select(ErrorCard).where(ErrorCard.card_id.in_(card_ids)))
        .scalars()
        .all()
    )
    hards = (
        db.execute(select(HardCard).where(HardCard.card_id.in_(card_ids)))
        .scalars()
        .all()
    )
    # 构建查找表：每个 card_id 按全库统一规则选当前状态
    grouped: dict[int, list[Review]] = {}
    for r in reviews:
        grouped.setdefault(r.card_id, []).append(r)
    review_map = {
        card_id: select_current_review(rows) for card_id, rows in grouped.items()
    }
    error_map = {e.card_id: e for e in errors}
    hard_set = {h.card_id for h in hards}
    # 展示接触需要每张卡当前修订（含句子卡），批量一次读取。
    revisions = content_revision_map(db, "card", card_ids)
    # 句子卡没有独立 typed 回忆，不应为它们扫描/分发无意义证据。
    evidence_map = bulk_evidence_summaries(
        db, [c.id for c in cards if c.kind == "word"], runtime
    )

    return {
        "cards": [
            _card_to_dict_fast(
                c,
                review_map.get(c.id),
                error_map.get(c.id),
                c.id in hard_set,
                evidence_map.get(c.id),
                revisions.get(c.id),
            )
            for c in cards
        ]
    }


@router.post("/cards/refresh-examples")
def refresh_examples(limit: int = 10, db: Session = Depends(get_db)):
    """批量刷新旧词卡的例句/讲解（旧 prompt 生成的平淡句）。

    找出 example 长度 < 30 或 explanation 不含 | 的 word 类型卡，
    调 regenerate_example 更新，每批最多 limit 个。
    """
    from app.services.card_generator import regenerate_example

    # 找需要刷新的卡
    all_words = db.execute(select(Card).where(Card.kind == "word")).scalars().all()

    needs_refresh = []
    for c in all_words:
        example = c.example or ""
        explanation = c.explanation or ""
        if len(example) < 30 or "|" not in explanation:
            needs_refresh.append(c)

    if not needs_refresh:
        return {"refreshed": 0, "remaining": 0, "total_weak": 0}

    batch = needs_refresh[:limit]
    before = {
        card.id: get_content_revision(db, "card", card.id) for card in batch
    }
    sentence_before = {}
    for card in batch:
        sentence = (
            db.execute(
                select(Card).where(Card.word == card.word, Card.kind == "sentence")
            )
            .scalars()
            .first()
        )
        if sentence is not None:
            sentence_before[card.id] = (
                sentence.id,
                get_content_revision(db, "card", sentence.id),
            )

    generated = []
    for card in batch:
        try:
            example, example_cn, explanation = regenerate_example(card.word)
            if example:
                generated.append((card.id, example, example_cn, explanation))
        except LLMNotConfigured:
            raise  # AI 未配置是整批不可用，不能伪装成“刷新了 0 条”
        except Exception:  # noqa: BLE001, S112 — 单个失败不阻塞整批
            continue

    if not generated:
        return {
            "refreshed": 0,
            "remaining": len(needs_refresh),
            "total_weak": len(needs_refresh),
        }

    def operation(session: Session) -> int:
        refreshed = 0
        for card_id, example, example_cn, explanation in generated:
            try:
                card = session.get(Card, card_id, populate_existing=True)
            except ObjectDeletedError:
                continue
            if card is None:
                continue
            try:
                card_revision = get_content_revision(session, "card", card_id)
            except LookupError:
                continue
            if card_revision != before[card_id]:
                continue  # 晚到生成不覆盖编辑或恢复后的内容
            advance_content_revision(
                session, "card", card_id, {"example": example, "example_cn": example_cn}
            )
            card.example = example
            card.example_cn = example_cn
            card.explanation = explanation
            refreshed += 1
            sentence = sentence_before.get(card_id)
            if sentence is None:
                continue
            sentence_id, revision = sentence
            try:
                sentence_card = session.get(
                    Card, sentence_id, populate_existing=True
                )
            except ObjectDeletedError:
                continue
            if sentence_card is None:
                continue
            try:
                sentence_revision = get_content_revision(session, "card", sentence_id)
            except LookupError:
                continue
            if sentence_revision != revision:
                continue
            advance_content_revision(
                session,
                "card",
                sentence_id,
                {"example": example, "example_cn": example_cn},
            )
            sentence_card.example = example
            sentence_card.example_cn = example_cn
        return refreshed

    refreshed = run_write(db, operation)
    return {
        "refreshed": refreshed,
        "remaining": len(needs_refresh) - refreshed,
        "total_weak": len(needs_refresh),
    }


@router.post("/cards/regenerate-sentences")
def regenerate_sentences(limit: int = 5, db: Session = Depends(get_db)):
    """为已毕业但没有句子卡的词重新生成句子卡（AI 生成更复杂的句子）。

    按统一毕业口径（card_is_graduated：word 且 state==2 或复习 >=3 次）找词，
    建兜底句卡并启动后台 AI 升级——与复习提交路径完全一致。
    """
    import contextvars as _contextvars
    import threading as _threading

    from app.services.graduation import (
        ensure_sentence_card,
        find_sentence_card,
        upgrade_sentence_card,
    )

    # 当前状态按全库统一规则收拢（last_review 最新，再 id）
    grouped: dict[int, list[Review]] = {}
    for r in db.execute(select(Review)).scalars().all():
        grouped.setdefault(r.card_id, []).append(r)
    latest = {card_id: select_current_review(rows) for card_id, rows in grouped.items()}

    # 找已毕业但没有句子卡的词
    needs_sentence = []
    for card in db.execute(select(Card).where(Card.kind == "word")).scalars().all():
        review = latest.get(card.id)
        if (
            review is not None
            and card_is_graduated(card, review)
            and find_sentence_card(db, card.word) is None
        ):
            needs_sentence.append(card)

    if not needs_sentence:
        return {"generated": 0, "remaining": 0, "total": 0}

    batch = needs_sentence[:limit]
    generated = 0
    for card in batch:
        try:
            sentence = ensure_sentence_card(card, db)
            if sentence:
                generated += 1
                ctx = _contextvars.copy_context()
                _threading.Thread(
                    target=ctx.run, args=(upgrade_sentence_card, card.id), daemon=True
                ).start()
        except Exception:  # noqa: BLE001, S112 — 单个失败不阻塞整批
            continue

    db.commit()
    return {
        "generated": generated,
        "remaining": len(needs_sentence) - generated,
        "total": len(needs_sentence),
    }


@router.get("/cards/{card_id}")
def get_card_detail(
    card_id: int,
    db: Session = Depends(get_db),
    runtime: Runtime = Depends(get_runtime),
):
    """单词详情：全部字段 + 复习历史 + 毕业状态 + 回忆证据。"""
    card = db.get(Card, card_id)
    if card is None:
        raise HTTPException(status_code=404, detail="Card not found")

    latest = get_memory_state(db, card_id)
    history = get_legacy_review_history(db, card_id)
    error = (
        db.execute(select(ErrorCard).where(ErrorCard.card_id == card_id))
        .scalars()
        .first()
    )
    memo = db.execute(select(Memo).where(Memo.card_id == card_id)).scalars().first()
    hard = (
        db.execute(select(HardCard).where(HardCard.card_id == card_id))
        .scalars()
        .first()
    )
    history_incomplete = has_incomplete_history(db, card_id)
    evidence = evidence_summary(
        db, card_id, runtime, incomplete_history=history_incomplete
    )
    last_contact, contact_integrity = contact_summary(db, card_id)

    return {
        "id": card.id,
        "word": card.word,
        "kind": card.kind,
        "phonetic": card.phonetic,
        "meaning": card.meaning,
        "example": card.example,
        "example_cn": card.example_cn,
        "explanation": card.explanation,
        "contexts": card.contexts,
        "related_words": card.related_words,
        "chunks": card.chunks,
        "difficulty": card.difficulty,
        "created_at": card.created_at.isoformat(),
        "graduated": card_is_graduated(card, latest),
        "review_count": latest.review_count if latest else 0,
        "error_count": error.error_count if error else 0,
        "is_hard": hard is not None,
        "memo": memo.content if memo else None,
        "next_due": latest.due.isoformat() if latest else None,
        "review_history": history,
        "memory_state": (
            {
                "state": latest.state,
                "step": latest.step,
                "due": latest.due.isoformat() if latest.due else None,
                "stability": latest.stability,
                "difficulty": latest.difficulty,
                "elapsed_days": latest.elapsed_days,
                "last_review": (
                    latest.last_review.isoformat() if latest.last_review else None
                ),
                "review_count": latest.review_count,
                "rating": latest.rating,
            }
            if latest
            else None
        ),
        "learning_events": get_card_events(db, card_id),
        "history_incomplete": history_incomplete,
        "content_revision": evidence["revision"],
        "learning_evidence": evidence,
        "last_contact": last_contact,
        "contact_integrity": contact_integrity,
    }
