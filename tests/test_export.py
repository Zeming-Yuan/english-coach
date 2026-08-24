"""导出 API 测试。"""

import json

from app.models.card import Card


def test_export_cards(client, db_session):
    """全量备份 JSON 含词卡/复习/记忆法。"""
    db_session.add(Card(word="apple", meaning="苹果", kind="word"))
    db_session.commit()
    resp = client.get("/api/export/cards")
    assert resp.status_code == 200
    data = json.loads(resp.content)
    assert data["cards"][0]["word"] == "apple"
    assert data["cards"][0]["meaning"] == "苹果"
    assert "reviews" in data and "memos" in data


def test_export_anki_csv(client, db_session):
    """Anki CSV：word 列正确、句子卡不导出、中文 BOM。"""
    db_session.add(Card(word="apple", meaning="苹果", kind="word"))
    db_session.add(Card(word="I am fine", meaning="我很好", kind="sentence"))
    db_session.commit()
    resp = client.get("/api/export/anki")
    assert resp.status_code == 200
    text = resp.content.decode("utf-8")
    assert "apple" in text
    assert "I am fine" not in text
    assert text.startswith("\ufeff")  # BOM
