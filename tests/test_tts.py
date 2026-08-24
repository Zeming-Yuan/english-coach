"""发音路由测试（mock edge-tts，不真合成）。"""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routers import tts


@pytest.fixture(autouse=True)
def _no_real_tts(monkeypatch):
    """所有测试默认 mock 掉 edge-tts 合成（避免真网络请求）。"""

    async def _fake_synthesize(text: str):
        yield b"fake-mp3-chunk-1"
        yield b"fake-mp3-chunk-2"

    monkeypatch.setattr(tts, "_synthesize", _fake_synthesize)
    tts._cache.clear()
    yield
    tts._cache.clear()


def test_tts_audio_ok():
    """GET /api/tts/audio/rain → 200 + 音频字节流。"""
    client = TestClient(app)
    resp = client.get("/api/tts/audio/rain")
    assert resp.status_code == 200
    assert resp.content == b"fake-mp3-chunk-1fake-mp3-chunk-2"
    assert "audio/mpeg" in resp.headers["content-type"]


def test_tts_audio_cache_hit(monkeypatch):
    """缓存命中：第二次请求不再调合成。"""
    client = TestClient(app)
    # 第一次（走合成）
    client.get("/api/tts/audio/rain")
    # 第二次：合成器计数应不变（缓存命中）
    calls = {"n": 0}

    async def _counting(text: str):
        calls["n"] += 1
        yield b"x"

    monkeypatch.setattr(tts, "_synthesize", _counting)
    client.get("/api/tts/audio/rain")
    assert calls["n"] == 0  # 未再合成


def test_tts_audio_empty():
    """空文本 → 400。"""
    client = TestClient(app)
    resp = client.get("/api/tts/audio/ ")
    assert resp.status_code == 400


def test_tts_audio_invalid_chars():
    """非法字符（中文）→ 400。"""
    client = TestClient(app)
    resp = client.get("/api/tts/audio/%E9%9B%A8")  # 雨
    assert resp.status_code == 400


def test_tts_audio_too_long():
    """超长文本 → 400。"""
    client = TestClient(app)
    resp = client.get("/api/tts/audio/" + "a" * 300)
    assert resp.status_code == 400


def test_tts_audio_synthesis_fails(monkeypatch):
    """合成失败（网络异常）→ 流式输出空（前端静默，不 500）。"""
    async def _boom(text: str):
        raise OSError("network down")
        yield  # 让 async generator 形状成立

    monkeypatch.setattr(tts, "_synthesize", _boom)
    client = TestClient(app)
    resp = client.get("/api/tts/audio/rain")
    assert resp.status_code == 200  # 流式端点始终 200，失败输出空
    assert resp.content == b""


def test_tts_preload_caches(monkeypatch):
    """/preload 预合成入缓存。"""
    async def _fake_synthesize(text: str):
        yield b"abc"

    monkeypatch.setattr(tts, "_synthesize", _fake_synthesize)
    client = TestClient(app)
    resp = client.get("/api/tts/audio/banana/preload")
    assert resp.json()["cached"] is True
