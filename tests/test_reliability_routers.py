"""Public HTTP regressions for the reliability router slice."""

import pytest


@pytest.mark.parametrize("days", [-1, 0, 367, 100000000])
def test_history_rejects_unbounded_days(client, days):
    response = client.get("/api/stats/history", params={"days": days})
    assert response.status_code == 422


@pytest.mark.parametrize("sentences", ["oops", {"cn": "坏"}, ["oops"], [{"cn": 3}]])
def test_malformed_optional_story_translation_keeps_story_readable(
    client, db_session, monkeypatch, sentences
):
    from app.models.story import Story

    story = Story(title="Original", content="A cat sits.")
    db_session.add(story)
    db_session.commit()
    monkeypatch.setattr(
        "app.routers.stories.generate_json",
        lambda *args: {"title_cn": "猫", "sentences": sentences},
    )
    response = client.get(f"/api/stories/{story.id}")
    assert response.status_code == 200
    assert response.json()["content_cn"] is None
    assert response.json()["title_cn"] is None


def test_revised_story_list_does_not_offer_old_check_session(ec):
    from app.models.story import Story
    from app.services.content_revisions import advance_content_revision
    from tests.test_el11_bounded_personalized_story import _generate, verified
    from tests.test_el13_story_reading_check import create_check

    verified(ec)
    story = _generate(ec).json()
    run = create_check(ec, story).json()
    assert (
        ec.client.get("/api/stories").json()["stories"][0]["check_session_id"]
        == run["id"]
    )
    with ec._session() as db:
        text = db.get(Story, story["id"])
        advance_content_revision(db, "story", text.id, {"title": "Rewritten"})
        text.title = "Rewritten"
        db.commit()
    listed = ec.client.get("/api/stories").json()["stories"][0]
    assert listed["mode"] == "legacy"
    assert listed["check_session_id"] is None
    assert (
        ec.client.get(f"/api/stories/{story['id']}").json()["check_session_id"] is None
    )


def test_concurrent_hard_toggles_are_serialized(client, db_session):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from time import sleep

    from sqlalchemy import event

    from app.models.card import Card

    card = Card(word="pear", kind="word")
    db_session.add(card)
    db_session.commit()
    card_id = card.id
    engine = db_session.get_bind()
    start = Barrier(2)

    def delay_read(conn, cursor, statement, parameters, context, executemany):
        if (
            statement.lstrip().upper().startswith("SELECT")
            and "hard_cards" in statement
        ):
            sleep(0.1)  # Both unprotected reads see the empty mark before inserting.

    def toggle():
        start.wait(timeout=5)
        return client.post(f"/api/cards/{card_id}/hard")

    event.listen(engine, "after_cursor_execute", delay_read)
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(lambda _: toggle(), range(2)))
    finally:
        event.remove(engine, "after_cursor_execute", delay_read)
    assert [r.status_code for r in responses] == [200, 200]
    assert sorted(r.json()["is_hard"] for r in responses) == [False, True]
    assert client.get(f"/api/cards/{card_id}").json()["is_hard"] is False


def test_lookup_reuses_mixed_case_card_with_same_id_on_repeat(
    client, db_session, monkeypatch
):
    from app.models.card import Card
    from app.routers import lookup

    lookup._cache.clear()
    card = Card(word="HeLLo", kind="word", meaning="你好")
    db_session.add(card)
    db_session.commit()
    monkeypatch.setattr("app.routers.lookup.generate_json", lambda *args: None)
    try:
        for word in ["hello", "HELLO", "hello"]:
            response = client.get(f"/api/lookup/{word}")
            assert response.status_code == 200
            assert response.json()["found"] is True
            assert response.json()["card_id"] == card.id
            assert response.json()["meaning"] == "你好"
    finally:
        lookup._cache.clear()


@pytest.mark.parametrize(
    "peer,headers",
    [
        ("198.51.100.3", {}),
        ("127.0.0.1", {"X-Forwarded-For": "198.51.100.3"}),
        ("127.0.0.1", {"Forwarded": "for=198.51.100.3"}),
        ("::1", {"X-Real-IP": "198.51.100.3"}),
    ],
)
@pytest.mark.parametrize(
    "method,path", [("POST", "/api/ai-config/test"), ("PUT", "/api/ai-config")]
)
def test_ai_management_rejects_remote_and_proxy_requests(
    ec, monkeypatch, peer, headers, method, path
):
    from fastapi.testclient import TestClient

    called = []
    monkeypatch.setattr(
        "app.routers.ai_config._probe", lambda settings: called.append(settings)
    )
    with TestClient(ec.app, client=(peer, 50000)) as remote:
        response = remote.request(
            method,
            path,
            headers=headers,
            json={
                "base_url": "http://169.254.169.254/v1",
                "model": "m",
                "api_key": "test",
            },
        )
    assert response.status_code == 403
    assert called == []
    assert not (ec.root / "llm_config.json").exists()


@pytest.mark.parametrize("peer", ["127.0.0.1", "::1"])
def test_local_ai_probe_sanitizes_exception_details(ec, monkeypatch, peer):
    from fastapi.testclient import TestClient

    def broken(settings):
        raise RuntimeError("credential sk-private internal-host 169.254.169.254")

    monkeypatch.setattr("app.routers.ai_config._probe", broken)
    with TestClient(ec.app, client=(peer, 50000)) as local:
        response = local.post(
            "/api/ai-config/test",
            json={
                "base_url": "http://127.0.0.1:9000/v1",
                "model": "m",
                "api_key": "test",
            },
        )
    assert response.status_code == 200
    assert response.json() == {
        "ok": False,
        "error": "AI 连接失败；请检查服务地址、网络、密钥和模型",
    }


def test_legacy_export_reports_actual_timestamp(ec):
    ec.set_time("2026-11-05T03:00:00Z")
    response = ec.client.get("/api/export/cards")
    assert response.status_code == 200
    assert response.json()["exported_at"] == "2026-11-05T03:00:00+00:00"


def test_missing_card_memo_read_matches_write_status(client):
    assert client.get("/api/memos/999").status_code == 404
    assert client.put("/api/memos/999", json={"content": "memo"}).status_code == 404


def test_tts_cache_hit_refreshes_recency(client, monkeypatch):
    from app.routers import tts

    calls = []

    async def synth(text):
        calls.append(text)
        return b"audio"

    monkeypatch.setattr(tts, "_synthesize_all", synth)
    monkeypatch.setattr(tts, "_CACHE_MAX", 4)
    tts._cache.clear()
    try:
        for word in ["cat", "dog", "rain", "sun", "cat", "pear", "cat"]:
            assert client.get(f"/api/tts/audio/{word}").status_code == 200
        assert calls == ["cat", "dog", "rain", "sun", "pear"]
    finally:
        tts._cache.clear()


def test_tts_preload_transport_failure_is_not_an_internal_error(client, monkeypatch):
    from app.routers import tts

    async def broken(text):
        raise RuntimeError("edge transport closed")

    monkeypatch.setattr(tts, "_synthesize_all", broken)
    tts._cache.clear()
    response = client.get("/api/tts/audio/pear/preload")
    assert response.status_code == 200
    assert response.json() == {"cached": False}


def test_listening_selects_due_card_before_new_cards(client, db_session):
    from datetime import datetime, timedelta

    from app.models.card import Card
    from app.models.review import Review

    cards = [
        Card(word=word, kind="word")
        for word in ["apple", "pear", "cat", "dog", "rain", "sun"]
    ]
    db_session.add_all(cards)
    db_session.flush()
    due_id = cards[-1].id
    db_session.add(
        Review(
            card_id=due_id,
            state=2,
            due=datetime.now() - timedelta(days=1),
            review_count=3,
            stability=1.0,
            difficulty=5.0,
            elapsed_days=1,
        )
    )
    db_session.commit()
    response = client.get("/api/listening", params={"limit": 1})
    assert response.status_code == 200
    assert [q["card_id"] for q in response.json()["questions"]] == [due_id]


def test_same_time_adaptive_sample_uses_saved_order(ec, monkeypatch):
    """Cross-slice: R supplies saved_order; S chooses the first saved event."""
    from uuid import UUID

    from tests.test_adaptive_limit import _review

    ec.set_time("2026-11-05T03:00:00Z")
    card_id = ec.seed_card("apple")
    ids = iter(
        [
            UUID("ffffffff-ffff-4fff-bfff-ffffffffffff"),
            UUID("00000000-0000-4000-8000-000000000001"),
        ]
    )
    monkeypatch.setattr("app.services.learning.uuid4", lambda: next(ids))
    assert _review(ec, card_id, 1).status_code == 200
    assert _review(ec, card_id, 3).status_code == 200
    result = ec.client.get("/api/today").json()
    assert result["sample_count"] == 1
    assert result["recommended_goal"] == 5


def test_cached_lookup_preserves_local_card_id(client, db_session):
    from app.models.card import Card
    from app.routers import lookup

    lookup._cache.clear()
    card = Card(word="pear", kind="word", meaning="梨")
    db_session.add(card)
    db_session.commit()
    try:
        first = client.get("/api/lookup/pear").json()
        repeated = client.get("/api/lookup/PEAR").json()
        assert first["card_id"] == card.id
        assert repeated["card_id"] == first["card_id"]
    finally:
        lookup._cache.clear()
