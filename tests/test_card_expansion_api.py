"""词卡构词与扩展的生成、保存及并发边界。"""

from app.routers import cards
from tests.support.llm_queue import QueuedLLM

FORMATION = {"kind": "formation", "text": "un-（不） + happy（高兴的）"}
AFFIX = {"kind": "affix", "word": "unfair", "meaning": "不公平的"}
LEGACY = {"word": "upset", "meaning": "难过的"}


def test_backfill_saves_typed_rows_once_preserving_legacy_and_backup(ec, ec_factory):
    card_id = ec.seed_card("unhappy", meaning="不高兴的", related_words=[LEGACY])
    path = f"/api/cards/{card_id}"
    revision = ec.client.get(path).json()["content_revision"]
    ec.app.state.llm_client = QueuedLLM([{"related_words": [FORMATION, AFFIX]}])
    rows = [FORMATION, AFFIX, LEGACY]

    response = ec.client.post(path + "/expansions", json=revision)
    assert response.status_code == 200, response.text
    assert response.json() == {"related_words": rows, "content_revision": revision}
    assert ec.client.post(path + "/expansions").json() == response.json()
    assert ec.client.get(path).json()["related_words"] == rows

    backup = ec.client.get("/api/export/backup").json()
    restored = ec_factory().client
    preview = restored.post("/api/import/preview", json=backup).json()
    result = restored.post(
        "/api/import/cards",
        json={"backup": backup, "expected_revision": preview["expected_revision"]},
    )
    assert result.status_code == 200, result.text
    assert restored.get("/api/cards").json()["cards"][0]["related_words"] == rows


def test_backfill_failure_preserves_existing_words_and_can_retry(ec):
    card_id = ec.seed_card("unhappy", related_words=[LEGACY])
    path = f"/api/cards/{card_id}"
    rows = [{"kind": "synonym", **LEGACY}]
    ec.app.state.llm_client = QueuedLLM([{}, {"related_words": rows}])
    assert ec.client.post(path + "/expansions").status_code == 502
    assert ec.client.get(path).json()["related_words"] == [LEGACY]
    assert ec.client.post(path + "/expansions").json()["related_words"] == rows


def test_backfill_rejects_word_edited_while_generating(ec, monkeypatch):
    card_id = ec.seed_card("unhappy", meaning="不高兴的")
    path = f"/api/cards/{card_id}"
    revision = ec.client.get(path).json()["content_revision"]

    def edit_while_generating(word, meaning):
        assert (word, meaning) == ("unhappy", "不高兴的")
        assert ec.client.put(path, json={"word": "happy"}).status_code == 200
        return [FORMATION, AFFIX]

    monkeypatch.setattr(
        cards, "generate_expansions", edit_while_generating, raising=False
    )
    assert ec.client.post(path + "/expansions").status_code == 409
    assert not ec.client.get(path).json()["related_words"]
    assert ec.client.post(path + "/expansions", json=revision).status_code == 409


def test_changing_word_sense_clears_generated_material(ec):
    card_id = ec.seed_card(
        "unhappy", meaning="不高兴的", related_words=[FORMATION, AFFIX]
    )
    path = f"/api/cards/{card_id}"
    assert ec.client.put(path, json={"meaning": " 不高兴的 "}).json()["related_words"]
    assert not ec.client.put(path, json={"word": "happy"}).json()["related_words"]


def test_sentence_and_missing_card_have_no_backfill(ec):
    card_id = ec.seed_card(kind="sentence")
    assert ec.client.post(f"/api/cards/{card_id}/expansions").status_code == 422
    assert ec.client.post("/api/cards/999/expansions").status_code == 404


def test_legacy_apple_uses_matching_starter_sense_without_ai(ec):
    card_id = ec.seed_card("apple", meaning="苹果")
    path = f"/api/cards/{card_id}/expansions"
    response = ec.client.post(path)
    assert response.status_code == 200, response.text
    by_word = {row["word"]: row["kind"] for row in response.json()["related_words"]}
    assert by_word["apply"] == by_word["applet"] == "lookalike"
    assert by_word["applesauce"] == "compound"
    assert ec.client.put(
        f"/api/cards/{card_id}", json={"meaning": "苹果公司"}
    ).is_success
    assert ec.client.post(path).status_code == 503


def test_backfill_rejects_source_removed_while_generating(ec, monkeypatch):
    card_id = ec.seed_card("unhappy", meaning="不高兴的")
    path = f"/api/cards/{card_id}"
    revision = ec.client.get(path).json()["content_revision"]

    def remove_source(word, meaning):
        assert ec.client.delete(path).is_success
        return [FORMATION, AFFIX]

    monkeypatch.setattr(cards, "generate_expansions", remove_source)
    assert ec.client.post(path + "/expansions", json=revision).status_code == 404
    assert ec.client.get("/api/cards").json()["cards"] == []


def test_backfill_rejects_old_source_after_full_restore(ec, monkeypatch):
    card_id = ec.seed_card("unhappy", meaning="不高兴的")
    path = f"/api/cards/{card_id}"
    revision = ec.client.get(path).json()["content_revision"]
    backup = ec.client.get("/api/export/backup").json()
    preview = ec.client.post("/api/import/preview", json=backup).json()

    def restore_source(word, meaning):
        response = ec.client.post(
            "/api/import/cards",
            json={"backup": backup, "expected_revision": preview["expected_revision"]},
        )
        assert response.is_success, response.text
        return [FORMATION, AFFIX]

    monkeypatch.setattr(cards, "generate_expansions", restore_source)
    assert ec.client.post(path + "/expansions", json=revision).status_code == 404
    (restored,) = ec.client.get("/api/cards").json()["cards"]
    assert restored["id"] != card_id
    assert restored["content_revision"] == revision
    assert not restored["related_words"]
