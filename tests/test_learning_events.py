"""学习事件与原子提交契约测试（EC-03）。

覆盖 Review Focus：
RF1 相同标识同内容回放不重复排期；
RF2 相同标识不同内容返回 409；
RF3 旧多行可追溯且不伪造事件；
RF4 提交中途失败事件/排期/错词全部回滚；
RF5 删卡不留下事件/基线悬空关系。
"""

import json
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError

from alembic import command
from app.schemas.learning import AttemptCommand
from app.services.learning import classify_attempt


def _dt(*args) -> datetime:
    """旧 reviews 表使用 naive UTC，测试前置数据保持一致。"""
    return datetime(*args)  # noqa: DTZ001

ROOT = Path(__file__).resolve().parents[1]


def _migration_config(url: str) -> Config:
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", url)
    return config


def _review_payload(card_id: int, **overrides) -> dict:
    payload = {
        "card_id": card_id,
        "rating": 3,
        "source": "study",
        "kind": "self_rating",
        "submission_id": str(uuid4()),
    }
    payload.update(overrides)
    return payload


def test_review_replay_has_one_event(ec):
    card_id = ec.seed_card()
    payload = {
        "card_id": card_id,
        "rating": 3,
        "source": "study",
        "kind": "self_rating",
        "submission_id": str(uuid4()),
    }
    first = ec.client.post("/api/reviews", json=payload)
    second = ec.client.post("/api/reviews", json=payload)
    assert first.status_code == second.status_code == 200
    assert first.json()["committed"] is True
    assert first.json() == second.json()
    detail = ec.client.get(f"/api/cards/{card_id}").json()
    assert len(detail["learning_events"]) == 1
    assert detail["memory_state"]["review_count"] == 1


def test_replay_does_not_change_schedule_or_error_weight(ec):
    """RF1：回放不再次推进 FSRS，也不重复加减错词权重。"""
    card_id = ec.seed_card()
    payload = _review_payload(card_id, rating=1)
    assert ec.client.post("/api/reviews", json=payload).status_code == 200
    before = ec.client.get(f"/api/cards/{card_id}").json()

    replay = ec.client.post("/api/reviews", json=payload)
    assert replay.status_code == 200
    after = ec.client.get(f"/api/cards/{card_id}").json()

    assert after["memory_state"] == before["memory_state"]
    assert after["error_count"] == before["error_count"] == 1
    assert len(after["learning_events"]) == 1


@pytest.mark.parametrize(
    ("mutation", "status"),
    [
        ({"rating": 1}, 409),
        ({"assistance": ["unknown_hint"]}, 422),
        ({"rating": 5}, 422),
        ({"source": "unknown_source"}, 422),
    ],
)
def test_replay_conflict_and_invalid_payload(ec, mutation, status):
    """RF2：同标识不同内容 409；未知枚举/非法评分 422，且不新增事件。"""
    card_id = ec.seed_card()
    command = _review_payload(card_id)
    assert ec.client.post("/api/reviews", json=command).status_code == 200
    response = ec.client.post("/api/reviews", json={**command, **mutation})
    assert response.status_code == status
    detail = ec.client.get(f"/api/cards/{card_id}").json()
    assert len(detail["learning_events"]) == 1
    assert detail["memory_state"]["review_count"] == 1


def test_legacy_request_is_unclassified_and_incomplete(ec):
    """RF3：无提交标识/来源的旧调用仍是旧语义，但明确标为未分类。"""
    card_id = ec.seed_card()
    response = ec.client.post("/api/reviews", json={"card_id": card_id, "rating": 2})
    assert response.status_code == 200
    assert response.json()["committed"] is True

    detail = ec.client.get(f"/api/cards/{card_id}").json()
    assert detail["history_incomplete"] is True
    assert len(detail["learning_events"]) == 1
    event = detail["learning_events"][0]
    assert event["source"] == "legacy"
    assert event["kind"] == "self_rating"
    assert event["self_rating"] == 2
    assert event["correct"] is None
    assert event["scheduled"] is True
    # 旧调用照常推进排期
    assert detail["memory_state"]["review_count"] == 1


def test_new_source_events_do_not_claim_incomplete_history(ec):
    card_id = ec.seed_card()
    assert ec.client.post("/api/reviews", json=_review_payload(card_id)).status_code == 200
    detail = ec.client.get(f"/api/cards/{card_id}").json()
    assert detail["history_incomplete"] is False
    assert len(detail["learning_events"]) == 1


def test_baseline_preserves_multiple_old_rows(tmp_path):
    """RF3：升级前的同卡多行各存基线；选中最新有效行；不伪造事件。"""
    database = tmp_path / "legacy.db"
    url = f"sqlite:///{database.as_posix()}"
    config = _migration_config(url)
    command.upgrade(config, "b1c2d3e4f501")

    engine = create_engine(url)
    try:
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO cards (word, kind) VALUES ('apple', 'word')"))
            conn.execute(
                text(
                    "INSERT INTO reviews (card_id, state, step, due, stability, "
                    "difficulty, elapsed_days, last_review, review_count, rating) "
                    "VALUES (1, 1, 0, '2026-10-28 12:00:00', 1.0, 5.0, 0, "
                    "'2026-10-28 12:00:00', 1, 2)"
                )
            )
            conn.execute(
                text(
                    "INSERT INTO reviews (card_id, state, step, due, stability, "
                    "difficulty, elapsed_days, last_review, review_count, rating) "
                    "VALUES (1, 2, 0, '2026-10-29 12:00:00', 3.0, 4.0, 1, "
                    "'2026-10-29 12:00:00', 3, 3)"
                )
            )
    finally:
        engine.dispose()

    command.upgrade(config, "head")

    engine = create_engine(url)
    try:
        with engine.connect() as conn:
            baselines = conn.execute(
                text(
                    "SELECT source_review_id, selected, cumulative_count, "
                    "last_activity, raw FROM review_baselines ORDER BY source_review_id"
                )
            ).all()
            assert len(baselines) == 2
            assert [bool(row.selected) for row in baselines] == [False, True]
            assert [row.cumulative_count for row in baselines] == [1, 3]
            raw_rows = [json.loads(row.raw) for row in baselines]
            assert {raw["rating"] for raw in raw_rows} == {2, 3}
            assert conn.execute(
                text("SELECT COUNT(*) FROM review_events")
            ).scalar_one() == 0
    finally:
        engine.dispose()

    from fastapi.testclient import TestClient
    from sqlalchemy.orm import sessionmaker

    from app.config import Settings
    from app.db import get_db
    from app.main import create_app
    from app.runtime import Runtime, SystemClock

    engine = create_engine(url, connect_args={"check_same_thread": False})
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    app = create_app(
        settings=Settings(_env_file=None, database_url=url, llm_api_key=""),
        runtime=Runtime(SystemClock()),
    )

    def override_get_db():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            detail = client.get("/api/cards/1").json()
    finally:
        engine.dispose()

    assert detail["learning_events"] == []
    assert detail["history_incomplete"] is True
    assert detail["memory_state"]["review_count"] == 3
    assert len(detail["review_history"]) == 2


def test_submission_id_is_unique_in_database(ec):
    """并发重试的最终保障：数据库拒绝第二个同 submission_id 的事件。"""
    from app.models.review_event import ReviewEvent

    card_id = ec.seed_card()
    payload = _review_payload(card_id)
    first = ec.client.post("/api/reviews", json=payload)
    assert first.status_code == 200

    with pytest.raises(IntegrityError), ec.engine.begin() as conn:
        conn.execute(
            ReviewEvent.__table__.insert().values(
                id=str(uuid4()),
                submission_id=payload["submission_id"],
                card_id=card_id,
                source="study",
                kind="self_rating",
                stage="standalone",
                occurred_at=datetime(2026, 10, 30, 12, 0, tzinfo=timezone.utc),
                learning_day="2026-10-30",
                learning_timezone="Asia/Shanghai",
                answer=None,
                correct=None,
                skipped=False,
                scheduled=True,
                assistance=[],
                self_rating=3,
                fsrs_rating=3,
                before=None,
                after=None,
                fingerprint="x" * 64,
                command_json={},
                response={},
                session_id=None,
            )
        )


def test_failed_commit_keeps_state_and_errors(ec):
    """RF4：提交中途失败时事件、排期、错词全部回滚，且不返回已完成。"""
    card_id = ec.seed_card()
    ec.fail_commit_once()
    response = ec.client.post("/api/reviews", json=_review_payload(card_id, rating=1))
    assert response.status_code == 500
    assert "committed" not in response.json()

    detail = ec.client.get(f"/api/cards/{card_id}").json()
    assert detail["learning_events"] == []
    assert detail["memory_state"] is None
    assert detail["error_count"] == 0
    assert detail["review_count"] == 0

    with ec.engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM review_events")).scalar_one() == 0
        assert conn.execute(text("SELECT COUNT(*) FROM reviews")).scalar_one() == 0
        assert conn.execute(text("SELECT COUNT(*) FROM error_cards")).scalar_one() == 0


def test_delete_card_clears_new_references(ec):
    """RF5：删卡后事件与基线不留悬空关系。"""
    card_id = ec.seed_card()
    assert ec.client.post("/api/reviews", json=_review_payload(card_id)).status_code == 200

    with ec.engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO review_baselines (id, card_id, source_review_id, "
                "source_kind, raw, selected, captured_at, last_activity, "
                "cumulative_count, source_fingerprint) VALUES "
                "(:id, :card_id, NULL, 'migration', :raw, 0, :captured_at, NULL, 1, :fp)"
            ),
            {
                "id": str(uuid4()),
                "card_id": card_id,
                "raw": json.dumps({"id": 1, "review_count": 1}),
                "captured_at": "2026-10-30 12:00:00",
                "fp": "f" * 64,
            },
        )

    assert ec.client.delete(f"/api/cards/{card_id}").status_code == 200
    assert ec.client.get(f"/api/cards/{card_id}").status_code == 404
    with ec.engine.connect() as conn:
        assert conn.execute(
            text("SELECT COUNT(*) FROM review_events WHERE card_id = :id"),
            {"id": card_id},
        ).scalar_one() == 0
        assert conn.execute(
            text("SELECT COUNT(*) FROM review_baselines WHERE card_id = :id"),
            {"id": card_id},
        ).scalar_one() == 0


@pytest.mark.parametrize(
    ("command", "expected", "result"),
    [
        ({"card_id": 1, "kind": "self_rating", "rating": 4, "source": "study"}, "apple", (None, 4)),
        ({"card_id": 1, "kind": "typed", "answer": "Apple", "source": "spelling"}, "apple", (True, 3)),
        ({"card_id": 1, "kind": "typed", "answer": "apl", "source": "spelling"}, "apple", (False, 1)),
        (
            {"card_id": 1, "kind": "typed", "answer": "apple", "source": "spelling",
             "assistance": ["first_letter"]},
            "apple",
            (True, None),
        ),
        ({"card_id": 1, "kind": "choice", "answer": "apple", "source": "quiz"}, "apple", (True, None)),
        ({"card_id": 1, "kind": "typed", "answer": "apple", "source": "legacy"}, "apple", (True, None)),
        ({"card_id": 1, "kind": "typed", "source": "spelling", "skipped": True}, "apple", (None, None)),
    ],
)
def test_classify_attempt_contract(command, expected, result):
    cmd = AttemptCommand(**command)
    assert classify_attempt(cmd, expected) == result


def test_current_state_prefers_last_review_over_id(ec):
    """旧库多行时，详情与列表都必须按 last_review 选当前状态，而不是 id。"""
    from app.models.review import Review

    card_id = ec.seed_card()
    db = ec.SessionLocal()
    try:
        db.add(
            Review(
                card_id=card_id,
                state=1,
                step=0,
                due=_dt(2026, 10, 30),
                stability=2.5,
                difficulty=5.0,
                elapsed_days=0,
                review_count=7,
                last_review=_dt(2026, 10, 29, 12, 0),
            )
        )
        db.commit()
        db.add(
            Review(
                card_id=card_id,
                state=1,
                step=0,
                due=_dt(2026, 10, 30),
                stability=2.5,
                difficulty=5.0,
                elapsed_days=0,
                review_count=2,
                last_review=_dt(2026, 10, 28, 12, 0),
            )
        )
        db.commit()
    finally:
        db.close()

    detail = ec.client.get(f"/api/cards/{card_id}").json()
    assert detail["memory_state"]["review_count"] == 7
    listed = ec.client.get("/api/cards").json()["cards"][0]
    assert listed["review_count"] == 7


def test_graduated_reports_current_state_on_later_attempts(ec):
    """已毕业卡再评时 graduated/sentence_card_id 仍是真实当前状态。"""
    from app.models.review import Review

    card_id = ec.seed_card(
        "apple",
        example="The fat cat sat on my laptop.",
        example_cn="胖猫坐在我的笔记本上。",
    )
    sentence_id = ec.seed_card(
        "apple",
        kind="sentence",
        example="The fat cat sat on my laptop.",
        example_cn="胖猫坐在我的笔记本上。",
    )
    db = ec.SessionLocal()
    try:
        db.add(
            Review(
                card_id=card_id,
                state=2,
                step=0,
                due=_dt(2026, 10, 30),
                stability=5.0,
                difficulty=5.0,
                elapsed_days=0,
                review_count=3,
                last_review=_dt(2026, 10, 29),
            )
        )
        db.commit()
    finally:
        db.close()

    first = ec.client.post(
        "/api/reviews",
        json={"card_id": card_id, "rating": 1, "submission_id": str(uuid4())},
    )
    assert first.status_code == 200
    assert first.json()["graduated"] is True
    assert first.json()["sentence_card_id"] == sentence_id

    second = ec.client.post(
        "/api/reviews",
        json={"card_id": card_id, "rating": 1, "submission_id": str(uuid4())},
    )
    assert second.status_code == 200
    assert second.json()["graduated"] is True
    assert second.json()["sentence_card_id"] == sentence_id


def test_downgrade_keeps_events_and_upgrade_is_idempotent(ec):
    """降级不得删除已追加事件；再次升级跳过 DDL 且数据不变。"""
    card_id = ec.seed_card()
    response = ec.client.post(
        "/api/reviews",
        json={"card_id": card_id, "rating": 3, "submission_id": str(uuid4())},
    )
    assert response.status_code == 200

    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", ec.database_url)
    command.downgrade(config, "b1c2d3e4f501")
    with ec.engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM review_events")).scalar_one() == 1

    command.upgrade(config, "head")
    with ec.engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM review_events")).scalar_one() == 1
