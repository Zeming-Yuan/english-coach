"""EC-02 入门词卡：显式添加、按单词和卡型去重、无 AI 也能完成首轮学习。"""

import pytest

STARTER_WORDS = [
    "apple",
    "banana",
    "teacher",
    "dog",
    "house",
    "book",
    "water",
    "hello",
    "cat",
    "school",
]


def test_starter_can_be_added_without_ai(ec):
    first = ec.client.post("/api/cards/starter")
    assert first.status_code == 200
    assert first.json()["generated"] == 10
    second = ec.client.post("/api/cards/starter")
    assert second.status_code == 200
    assert second.json()["generated"] == 0
    assert len(ec.client.get("/api/cards").json()["cards"]) == 10


def test_sentence_card_does_not_block_starter_word_card(ec):
    """RF3：同词句子卡与单词卡是不同卡型，不能互相阻止。"""
    sentence_id = ec.seed_card(word="apple", kind="sentence", meaning="我的句子卡")
    response = ec.client.post("/api/cards/starter")
    assert response.status_code == 200
    assert response.json()["generated"] == 10
    cards = ec.client.get("/api/cards").json()["cards"]
    apple_words = [c for c in cards if c["word"] == "apple" and c["kind"] == "word"]
    assert len(apple_words) == 1
    assert ec.client.get(f"/api/cards/{sentence_id}").json()["meaning"] == "我的句子卡"


@pytest.mark.parametrize("kind", ["word", "sentence"])
def test_starter_preserves_existing_card(ec, kind):
    """RF2：同名自定义内容不被覆盖；同词句子卡不阻止单词卡（RF3）。"""
    card_id = ec.seed_card(word="apple", kind=kind, meaning="我的自定义内容")
    response = ec.client.post("/api/cards/starter")
    assert response.status_code == 200
    detail = ec.client.get(f"/api/cards/{card_id}").json()
    assert detail["meaning"] == "我的自定义内容"
    apple_words = [
        card
        for card in ec.client.get("/api/cards").json()["cards"]
        if card["word"] == "apple" and card["kind"] == "word"
    ]
    assert len(apple_words) == 1
    if kind == "word":
        assert response.json()["generated"] == 9
        assert response.json()["skipped"] == 1
    else:
        assert response.json()["generated"] == 10
        assert response.json()["skipped"] == 0


def test_starter_content_is_verified(ec):
    """十个固定词目、音标/中文释义/完整例句+中文齐全，kind 由系统控制。"""
    response = ec.client.post("/api/cards/starter")
    cards = response.json()["cards"]
    assert [card["word"] for card in cards] == STARTER_WORDS
    for card in cards:
        assert card["kind"] == "word"
        assert card["phonetic"].strip()
        assert card["meaning"].strip()
        assert card["example"].strip()
        assert card["example_cn"].strip()


def test_starter_source_has_ten_unique_rows_without_kind():
    """内容文件只含业务字段：kind/difficulty 由系统控制，避免内容自带卡型。"""
    from app.services.starter_cards import starter_card_rows

    rows = starter_card_rows()
    assert [row["word"] for row in rows] == STARTER_WORDS
    assert len({row["word"] for row in rows}) == 10
    for row in rows:
        assert set(row) == {"word", "phonetic", "meaning", "example", "example_cn"}
        assert all(isinstance(value, str) and value.strip() for value in row.values())


def test_concurrent_adds_create_cards_once(ec):
    """RF1：并发重复点击时，存在检查与插入在同一写事务内串行化。"""
    import time
    from concurrent.futures import ThreadPoolExecutor

    from sqlalchemy import text

    # 先占住写锁，确保两个请求都经过存在检查再竞争写入（可复现的并发窗口）
    holder = ec.engine.connect()
    holder.execute(text("BEGIN IMMEDIATE"))
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [
                pool.submit(ec.client.post, "/api/cards/starter") for _ in range(2)
            ]
            time.sleep(0.5)
            holder.execute(text("COMMIT"))
            responses = [future.result(timeout=15) for future in futures]
    finally:
        holder.close()

    assert [response.status_code for response in responses] == [200, 200]
    assert sorted(response.json()["generated"] for response in responses) == [0, 10]
    assert len(ec.client.get("/api/cards").json()["cards"]) == 10


def test_starter_commit_failure_keeps_library_empty(ec):
    """RF5：写入失败不能留下半套卡片；重试后恰好十张。"""
    ec.fail_commit_once()
    failed = ec.client.post("/api/cards/starter")
    assert failed.status_code == 500
    assert ec.client.get("/api/cards").json()["cards"] == []

    retry = ec.client.post("/api/cards/starter")
    assert retry.status_code == 200
    assert retry.json()["generated"] == 10
    assert len(ec.client.get("/api/cards").json()["cards"]) == 10


def test_starter_learning_works_without_llm_key(ec):
    """RF4：无 AI 密钥也能加载入门词卡并完成一次真实评分。"""
    added = ec.client.post("/api/cards/starter")
    assert added.status_code == 200
    assert ec.client.post("/api/cards/generate", json={"words": ["pear"]}).status_code == 503

    card_id = added.json()["cards"][0]["id"]
    review = ec.client.post("/api/reviews", json={"card_id": card_id, "rating": 3})
    assert review.status_code == 200
    assert ec.client.get(f"/api/cards/{card_id}").json()["review_count"] == 1
