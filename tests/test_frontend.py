"""前端静态页与生产构建同步测试。"""

import hashlib
import re
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app

ROOT_DIR = Path(__file__).resolve().parents[1]
STATIC_DIR = ROOT_DIR / "app" / "static"
FRONTEND_DIR = ROOT_DIR / "frontend"


def _frontend_source_sha256() -> str:
    src_files = [
        p.relative_to(FRONTEND_DIR).as_posix()
        for p in (FRONTEND_DIR / "src").rglob("*")
        if p.is_file() and not re.search(r"\.test\.[cm]?js$", p.name)
    ]
    files = sorted(["index.html", "vite.config.js", *src_files])
    digest = hashlib.sha256()
    for rel in files:
        digest.update(f"{rel}\0".encode())
        digest.update((FRONTEND_DIR / rel).read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def test_index_serves_html():
    """首页 / 返回前端 HTML。"""
    client = TestClient(app)
    resp = client.get("/")
    assert resp.status_code == 200
    assert "text/html" in resp.headers["content-type"]
    assert "EnglishCoach" in resp.text


def test_static_css_served():
    """/static/style.css 可访问。"""
    client = TestClient(app)
    resp = client.get("/static/style.css")
    assert resp.status_code == 200
    assert "text/css" in resp.headers["content-type"]
    assert "--mint" in resp.text


def test_production_bundle_matches_frontend_source_without_stale_assets():
    """index.html 与当前前端源码摘要一致，且无历史 JS/CSS 或旧 app.js 残留。"""
    client = TestClient(app)
    assert client.get("/static/app.js").status_code == 404

    html = client.get("/").text
    stamp = re.search(
        r'<meta\s+name="ec-source-sha256"\s+content="([0-9a-f]{64})"', html
    )
    assert stamp is not None, "index.html missing ec-source-sha256 build stamp"
    assert stamp.group(1) == _frontend_source_sha256(), (
        "app/static bundle is stale relative to frontend/src; run `npm --prefix frontend run build`"
    )

    js_refs = sorted(re.findall(r'/static/assets/([^"\'\s>]+\.js)', html))
    css_refs = sorted(re.findall(r'/static/assets/([^"\'\s>]+\.css)', html))
    assert len(js_refs) >= 1
    assert len(css_refs) >= 1

    assets_dir = STATIC_DIR / "assets"
    assert sorted(p.name for p in assets_dir.glob("*.js")) == js_refs
    assert sorted(p.name for p in assets_dir.glob("*.css")) == css_refs

    for js_name in js_refs:
        js_resp = client.get(f"/static/assets/{js_name}")
        assert js_resp.status_code == 200
        assert "javascript" in js_resp.headers["content-type"]

    for css_name in css_refs:
        css_resp = client.get(f"/static/assets/{css_name}")
        assert css_resp.status_code == 200
        assert "text/css" in css_resp.headers["content-type"]


def test_favicon_uses_warm_terracotta_palette_without_legacy_mint():
    """/static/favicon.svg 使用暖纸陶土色书本图形，不残留旧薄荷绿或 Arial 字标。"""
    client = TestClient(app)
    resp = client.get("/static/favicon.svg")
    assert resp.status_code == 200
    assert "image/svg+xml" in resp.headers["content-type"]
    svg = resp.text.lower()
    assert "#a26243" in svg
    assert "<path" in svg
    for legacy in ("#2dbe9e", "#1f9e85", "arial"):
        assert legacy not in svg
