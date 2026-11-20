"""词卡 API 测试（生成端点 mock AI）。"""

from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest

from app.models.card import Card
from app.models.review import Review


def test_list_cards_empty(client):
    """空库 → 空列表。"""
    resp = client.get("/api/cards")
    assert resp.status_code == 200
    assert resp.json()["cards"] == []


def test_list_cards_with_review_state(client, db_session):
    """列表含复习状态：未毕业词 review_count=0，已毕业词 graduated=True。"""
    db_session.add(Card(word="apple", meaning="苹果", kind="word"))
    db_session.add(Card(word="banana", meaning="香蕉", kind="word"))
    db_session.commit()

    resp = client.get("/api/cards")
    cards = resp.json()["cards"]
    assert len(cards) == 2
    for c in cards:
        assert c["review_count"] == 0
        assert c["graduated"] is False


MOCK_GENERATE_DATA = {
    "cards": [
        {
            "word": "pear",
            "phonetic": "/per/",
            "meaning": "梨",
            "example": "I eat a pear.",
            "example_cn": "我吃一个梨。",
        }
    ]
}


@patch("app.services.card_generator.generate_json")
def test_generate_cards(mock_generate, client, db_session):
    """POST /api/cards/generate 生成词卡并返回。"""
    mock_generate.return_value = MOCK_GENERATE_DATA

    resp = client.post("/api/cards/generate", json={"words": ["pear"]})
    assert resp.status_code == 200
    data = resp.json()
    assert data["generated"] == 1
    assert data["skipped"] == 0
    assert data["cards"][0]["word"] == "pear"


def test_generate_cards_empty_words(client):
    """空单词列表 → 422。"""
    resp = client.post("/api/cards/generate", json={"words": []})
    assert resp.status_code == 422


def test_generate_cards_already_exists(client, db_session):
    """已存在的词跳过，不重复生成。"""
    db_session.add(Card(word="pear", meaning="梨", kind="word"))
    db_session.commit()

    with patch("app.services.card_generator.generate_json") as mock_generate:
        # 如果走到 API 调用，这里返回空 cards —— 应被 existing 过滤拦截
        mock_generate.return_value = {"cards": []}
        resp = client.post("/api/cards/generate", json={"words": ["pear"]})

    assert resp.status_code == 200
    assert resp.json()["generated"] == 0
    assert resp.json()["skipped"] == 1
    # generate_cards 对全新词调 API；已存在词直接跳过（不会 mock 到调用）
    mock_generate.assert_not_called()


def test_get_card_detail_not_found(client):
    """不存在的卡 → 404。"""
    resp = client.get("/api/cards/999")
    assert resp.status_code == 404


def test_get_card_detail_basic(client, db_session):
    """单词详情：返回全部字段 + 空复习历史。"""
    db_session.add(
        Card(
            word="hello",
            phonetic="/həˈloʊ/",
            meaning="你好",
            example="Hello, how are you?",
            example_cn="你好，你怎么样？",
            explanation="greeting",
            kind="word",
        )
    )
    db_session.commit()

    resp = client.get("/api/cards/1")
    assert resp.status_code == 200
    data = resp.json()
    assert data["word"] == "hello"
    assert data["phonetic"] == "/həˈloʊ/"
    assert data["meaning"] == "你好"
    assert data["explanation"] == "greeting"
    assert data["graduated"] is False
    assert data["review_count"] == 0
    assert data["next_due"] is None
    assert data["review_history"] == []


def test_get_card_detail_with_reviews(ec):
    """单词详情：含复习历史。"""
    from pathlib import Path

    from alembic.config import Config

    from alembic import command

    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", ec.database_url)
    card_id = ec.seed_card(word="world", meaning="世界")
    ec.rebuild_legacy_database("ec12_card_identity")
    db_session = ec.SessionLocal()
    client = ec.client

    # 模拟两次复习
    now = datetime.now(UTC).replace(tzinfo=None)
    db_session.add(
        Review(
            card_id=card_id,
            state=1,
            due=now + timedelta(days=1),
            stability=2.5,
            difficulty=0.3,
            elapsed_days=0,
            last_review=now - timedelta(hours=2),
            review_count=1,
        )
    )
    db_session.add(
        Review(
            card_id=card_id,
            state=2,
            due=now + timedelta(days=7),
            stability=5.0,
            difficulty=0.2,
            elapsed_days=1,
            last_review=now,
            review_count=2,
        )
    )
    db_session.commit()

    db_session.close()
    command.upgrade(config, "head")
    resp = client.get(f"/api/cards/{card_id}")
    data = resp.json()
    assert data["graduated"] is True  # state==3
    assert data["review_count"] == 2
    assert data["next_due"] is not None
    assert len(data["review_history"]) == 2


def test_update_card(client, db_session):
    """编辑词卡：只更新提供的字段。"""
    db_session.add(
        Card(word="apple", meaning="苹果", example="I eat an apple.", kind="word")
    )
    db_session.commit()
    resp = client.put(
        "/api/cards/1",
        json={"meaning": "苹果（水果）", "example": "The red apple fell down."},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["meaning"] == "苹果（水果）"
    assert data["example"] == "The red apple fell down."


def test_delete_card_cascades(client, db_session):
    """删除词卡：级联清 reviews/memos。"""
    from datetime import datetime

    from app.models.memo import Memo
    from app.models.review import Review

    card = Card(word="apple", meaning="苹果", kind="word")
    db_session.add(card)
    db_session.commit()
    db_session.refresh(card)
    now = datetime.now(UTC).replace(tzinfo=None)
    db_session.add(
        Review(
            card_id=card.id,
            state=1,
            due=now,
            stability=1.0,
            difficulty=1.0,
            elapsed_days=0,
            last_review=now,
            review_count=1,
        )
    )
    db_session.add(Memo(card_id=card.id, content="谐音记忆"))
    db_session.commit()
    resp = client.delete(f"/api/cards/{card.id}")
    assert resp.status_code == 200
    assert db_session.query(Review).filter_by(card_id=card.id).count() == 0
    assert db_session.query(Memo).filter_by(card_id=card.id).count() == 0


def test_update_card_not_found(client):
    resp = client.put("/api/cards/999", json={"meaning": "x"})
    assert resp.status_code == 404


@pytest.mark.parametrize(
    "invalid",
    [
        {
            "example": "The cat slept beside my desk all morning.",
            "example_cn": "猫睡在桌边。",
        },
        {"example": "new", "example_cn": "翻译", "explanation": None},
    ],
)
def test_regenerate_incomplete_output_preserves_content_and_revision(ec, invalid):
    from tests.support.llm_queue import QueuedLLM

    ec.client.post("/api/cards/starter")
    old = ec.client.get("/api/cards").json()["cards"][0]
    ec.app.state.llm_client = QueuedLLM([invalid])

    resp = ec.client.post(f"/api/cards/{old['id']}/regenerate")

    assert resp.status_code == 502
    current = ec.client.get(f"/api/cards/{old['id']}").json()
    for field in ("example", "example_cn", "explanation", "content_revision"):
        assert current[field] == old[field]


@pytest.mark.parametrize("cards", [None, "bad", {"word": "pear"}, 3])
def test_generate_non_array_cards_returns_upstream_failure(ec, cards):
    from tests.support.llm_queue import QueuedLLM

    ec.app.state.llm_client = QueuedLLM([{"cards": cards}])
    response = ec.client.post("/api/cards/generate", json={"words": ["pear"]})
    assert response.status_code == 502
    assert ec.client.get("/api/cards").json()["cards"] == []


@pytest.mark.parametrize(
    "extra",
    [
        {"unknown": "ignored"},
        {"id": 99999},
        {"created_at": "1990-01-01", "kind": "sentence", "difficulty": "reading"},
    ],
)
def test_generated_card_keeps_content_but_ignores_non_content_fields(ec, extra):
    from tests.support.llm_queue import QueuedLLM

    ec.app.state.llm_client = QueuedLLM(
        [{"cards": [{"word": "pear", "meaning": "梨", **extra}]}]
    )
    response = ec.client.post("/api/cards/generate", json={"words": ["pear"]})
    assert response.status_code == 200
    assert response.json()["generated"] == 1
    card_id = response.json()["cards"][0]["id"]
    card = ec.client.get(f"/api/cards/{card_id}").json()
    assert card["word"] == "pear"
    assert card["meaning"] == "梨"
    assert card["id"] != 99999
    assert not card["created_at"].startswith("1990")
    assert card["kind"] == "word"
    assert card["difficulty"] == "basic"


def test_generated_cards_skip_malformed_items_without_losing_valid_card(ec):
    from tests.support.llm_queue import QueuedLLM

    ec.app.state.llm_client = QueuedLLM(
        [
            {
                "cards": [
                    None,
                    "bad",
                    3,
                    {"word": ["pear"]},
                    {"word": "pear", "example": 42},
                    {"word": "apple", "meaning": "苹果"},
                ]
            }
        ]
    )
    response = ec.client.post("/api/cards/generate", json={"words": ["pear", "apple"]})
    assert response.status_code == 200
    assert response.json()["generated"] == 1
    assert response.json()["cards"][0]["word"] == "apple"


def test_regenerate_preview_keeps_stored_example_revision_and_evidence(ec):
    """预览换例句不落库、不递增内容修订，也不使既有独立回忆证据失效。"""
    from datetime import datetime
    from uuid import uuid4

    from tests.support.llm_queue import QueuedLLM

    card_id = ec.seed_card(
        word="apple",
        meaning="苹果",
        example="Old example.",
        example_cn="旧例句。",
        explanation="旧讲解",
    )
    for iso in ("2026-10-01T01:00:00Z", "2026-10-02T02:00:00Z"):
        ec.clock.set(datetime.fromisoformat(iso))
        check = ec.client.post(
            "/api/typing/check",
            json={
                "card_id": card_id,
                "user_input": "apple",
                "source": "spelling",
                "submission_id": str(uuid4()),
                "assistance": [],
            },
        )
        assert check.status_code == 200

    before = ec.client.get(f"/api/cards/{card_id}").json()
    assert before["learning_evidence"]["recall"]["status"] == "verified"

    ec.app.state.llm_client = QueuedLLM(
        [
            {
                "example": "A fresh preview example.",
                "example_cn": "新的预览例句。",
                "explanation": "新讲解",
            }
        ]
    )
    resp = ec.client.post(f"/api/cards/{card_id}/regenerate?preview=true")
    assert resp.status_code == 200
    preview = resp.json()
    assert preview["preview"] is True
    assert preview["example"] == "A fresh preview example."
    assert preview["example_cn"] == "新的预览例句。"
    assert preview["explanation"] == "新讲解"
    assert preview["content_revision"] == before["content_revision"]

    after = ec.client.get(f"/api/cards/{card_id}").json()
    assert after["example"] == "Old example."
    assert after["example_cn"] == "旧例句。"
    assert after["explanation"] == "旧讲解"
    assert after["content_revision"] == before["content_revision"]
    assert after["learning_evidence"]["recall"]["status"] == "verified"

    # 确认采用预览例句：PUT 校验匹配的 expected_revision，原子落库并推进修订、使旧回忆证据失效
    applied = ec.client.put(
        f"/api/cards/{card_id}",
        json={
            "example": preview["example"],
            "example_cn": preview["example_cn"],
            "explanation": preview["explanation"],
            "expected_revision": preview["content_revision"],
        },
    )
    assert applied.status_code == 200
    saved = ec.client.get(f"/api/cards/{card_id}").json()
    assert saved["example"] == "A fresh preview example."
    assert saved["content_revision"] == {
        "identity": before["content_revision"]["identity"],
        "version": before["content_revision"]["version"] + 1,
    }
    assert saved["learning_evidence"]["recall"]["status"] == "insufficient"


def test_regenerate_preview_detects_concurrent_commit_and_overlength_output(
    ec, monkeypatch
):
    """预览期间并发提交更新时返回 preview=False, stale=True；超长 LLM 输出返回 502。"""
    from app.models.card import Card as CardModel
    from app.routers import cards as cards_router
    from app.services.content_revisions import advance_content_revision
    from tests.support.llm_queue import QueuedLLM

    card_id = ec.seed_card(word="apple", meaning="苹果", example="Old example.")

    def concurrent_edit(_word):
        with ec.SessionLocal() as other_db:
            other = other_db.get(CardModel, card_id)
            assert other is not None
            advance_content_revision(other_db, "card", card_id, {"meaning": "脆苹果"})
            other.meaning = "脆苹果"
            other_db.commit()
        return ("Late preview example.", "晚到预览。", "用法|搭配|易错")

    monkeypatch.setattr(cards_router, "regenerate_example", concurrent_edit)
    stale_resp = ec.client.post(f"/api/cards/{card_id}/regenerate?preview=true")
    assert stale_resp.status_code == 200
    body = stale_resp.json()
    assert body["preview"] is False
    assert body["stale"] is True
    assert body["meaning"] == "脆苹果"
    assert body["example"] == "Old example."

    monkeypatch.undo()
    ec.app.state.llm_client = QueuedLLM(
        [{"example": "x" * 501, "example_cn": "翻译", "explanation": "用法|搭配|易错"}]
    )
    overlong = ec.client.post(f"/api/cards/{card_id}/regenerate?preview=true")
    assert overlong.status_code == 502


def test_update_card_rejects_stale_expected_revision(ec):
    """确认采用预览例句时校验 expected_revision，并发修改返回 409。"""
    card_id = ec.seed_card(word="apple", meaning="苹果", example="Old example.")
    before = ec.client.get(f"/api/cards/{card_id}").json()["content_revision"]

    # 模拟并发编辑推进了修订版本
    moved = ec.client.put(f"/api/cards/{card_id}", json={"meaning": "红苹果"})
    assert moved.status_code == 200

    stale = ec.client.put(
        f"/api/cards/{card_id}",
        json={
            "example": "New example.",
            "example_cn": "新例句。",
            "explanation": "新讲解",
            "expected_revision": before,
        },
    )
    assert stale.status_code == 409
    current = ec.client.get(f"/api/cards/{card_id}").json()
    assert current["meaning"] == "红苹果"
    assert current["example"] == "Old example."


def test_generation_preserves_existing_phrase_and_separates_sentence_card(ec):
    from tests.support.llm_queue import QueuedLLM

    existing = ec.seed_card(" Apple Juice ", meaning="自定义果汁")
    sentence = ec.seed_card("green tea", kind="sentence", meaning="自定义句子")
    ec.app.state.llm_client = QueuedLLM(
        [{"cards": [{"word": "  GREEN TEA  ", "meaning": "绿茶"}]}]
    )
    response = ec.client.post(
        "/api/cards/generate",
        json={"words": [" apple juice ", "green tea", " GREEN TEA "]},
    )
    assert response.status_code == 200
    result = response.json()
    assert result["existing_words"] == ["apple juice"]
    assert result["failed_words"] == []
    assert result["generated"] == 1
    assert result["skipped"] == 2
    assert [(card["word"], card["kind"]) for card in result["cards"]] == [
        ("green tea", "word")
    ]

    cards = {card["id"]: card for card in ec.client.get("/api/cards").json()["cards"]}
    assert len(cards) == 3
    assert cards[existing]["meaning"] == "自定义果汁"
    assert cards[sentence]["meaning"] == "自定义句子"
    replay = ec.client.post(
        "/api/cards/generate", json={"words": ["APPLE JUICE", "Green Tea"]}
    )
    assert replay.status_code == 200
    assert replay.json()["existing_words"] == ["APPLE JUICE", "Green Tea"]
    assert replay.json()["generated"] == 0


def test_generation_reports_missing_phrase_without_saving_model_extras(ec):
    from tests.support.llm_queue import QueuedLLM

    ec.app.state.llm_client = QueuedLLM(
        [
            {
                "cards": [
                    {"word": "pear", "meaning": "梨"},
                    {"word": "apple"},
                    {"word": "juice"},
                    {"word": "banana"},
                ]
            },
            {"cards": [{"word": "apple juice", "meaning": "苹果汁"}]},
        ]
    )
    request = {"words": ["apple juice", "pear"]}
    response = ec.client.post("/api/cards/generate", json=request)
    assert response.status_code == 200
    result = response.json()
    assert [card["word"] for card in result["cards"]] == ["pear"]
    assert result["existing_words"] == []
    assert result["failed_words"] == ["apple juice"]

    replay = ec.client.post("/api/cards/generate", json=request)
    assert replay.status_code == 200
    assert [card["word"] for card in replay.json()["cards"]] == ["apple juice"]
    assert replay.json()["existing_words"] == ["pear"]
    assert sorted(
        card["word"] for card in ec.client.get("/api/cards").json()["cards"]
    ) == ["apple juice", "pear"]


def test_overlapping_phrase_generation_saves_once(ec):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from tests.support.llm_queue import QueuedLLM

    requests_overlap = Barrier(2)

    class OverlappingLLM(QueuedLLM):
        def create(self, **kwargs):
            requests_overlap.wait(timeout=10)
            return super().create(**kwargs)

    card_data = {"cards": [{"word": "apple juice", "meaning": "苹果汁"}]}
    ec.app.state.llm_client = OverlappingLLM([card_data, card_data])
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(
                lambda word: ec.client.post(
                    "/api/cards/generate", json={"words": [word]}
                ),
                ["apple juice", "Apple Juice"],
            )
        )

    assert [response.status_code for response in responses] == [200, 200]
    assert sorted(response.json()["generated"] for response in responses) == [0, 1]
    assert sum(len(response.json()["existing_words"]) for response in responses) == 1
    assert len(ec.client.get("/api/cards").json()["cards"]) == 1


def test_generation_rejects_blank_items_without_writing(ec):
    response = ec.client.post("/api/cards/generate", json={"words": ["  \n  "]})
    assert response.status_code == 422
    assert ec.client.get("/api/cards").json()["cards"] == []


def test_generation_upstream_failure_reports_already_existing_words(ec):
    from tests.support.llm_queue import QueuedLLM

    ec.seed_card("pear", meaning="原有梨")
    ec.app.state.llm_client = QueuedLLM([RuntimeError("provider unavailable")])
    response = ec.client.post(
        "/api/cards/generate", json={"words": ["pear", "apple juice"]}
    )
    assert response.status_code == 502
    assert response.json()["existing_words"] == ["pear"]
    assert response.json()["failed_words"] == ["apple juice"]
    assert [card["word"] for card in ec.client.get("/api/cards").json()["cards"]] == [
        "pear"
    ]


def test_generated_phrase_preserves_spelling_and_revision_after_v3_restore(
    ec, ec_factory
):
    from tests.support.llm_queue import QueuedLLM

    ec.app.state.llm_client = QueuedLLM(
        [{"cards": [{"word": "APPLE  JUICE", "meaning": "苹果汁"}]}]
    )
    response = ec.client.post("/api/cards/generate", json={"words": ["Apple  Juice"]})
    assert response.status_code == 200
    generated = response.json()["cards"][0]
    backup = ec.client.get("/api/export/backup").json()

    target = ec_factory()
    preview = target.client.post("/api/import/preview", json=backup)
    assert preview.status_code == 200
    restore = target.client.post(
        "/api/import/cards",
        json={
            "backup": backup,
            "expected_revision": preview.json()["expected_revision"],
        },
    )
    assert restore.status_code == 200
    cards = target.client.get("/api/cards").json()["cards"]
    assert [card["word"] for card in cards] == ["Apple  Juice"]
    assert cards[0]["content_revision"] == generated["content_revision"]
