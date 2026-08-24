"""前端静态页测试。"""

from fastapi.testclient import TestClient

from app.main import app


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


def test_static_js_served():
    """/static/app.js 可访问。"""
    client = TestClient(app)
    resp = client.get("/static/app.js")
    assert resp.status_code == 200
    assert "javascript" in resp.headers["content-type"]
    assert "/api/today" in resp.text
