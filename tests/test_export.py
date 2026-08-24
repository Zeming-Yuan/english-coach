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


def test_import_roundtrip(client, db_session):
    """导出→导入回写：词库/复习/记忆法/错词。"""
    # 先建一张卡 + 复习 + 记忆法
    from datetime import datetime, timezone

    from app.models.memo import Memo
    from app.models.review import Review
    card = Card(word="apple", meaning="苹果", kind="word")
    db_session.add(card)
    db_session.commit()
    db_session.refresh(card)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    db_session.add(Review(card_id=card.id, state=1, step=0, due=now, stability=2.5, difficulty=1.0, elapsed_days=0, last_review=now, review_count=3, rating=3))
    db_session.add(Memo(card_id=card.id, content="谐音"))
    db_session.commit()
    data = client.get("/api/export/cards").json()
    # 清空后导入
    db_session.query(Review).delete()
    db_session.query(Memo).delete()
    db_session.query(Card).delete()
    db_session.commit()
    resp = client.post("/api/import/cards", json=data)
    assert resp.status_code == 200
    result = resp.json()
    assert result["imported_words"] >= 1
    # 验证回写
    cards = db_session.query(Card).all()
    assert len(cards) >= 1
    asserts_ok = False
    for c in cards:
        if c.word == "apple":
            rv = db_session.query(Review).filter_by(card_id=c.id).first()
            mem = db_session.query(Memo).filter_by(card_id=c.id).first()
            assert rv is not None and rv.review_count == 3
            assert mem is not None and mem.content == "谐音"
            asserts_ok = True
    assert asserts_ok


def test_import_dedup_by_word(client, db_session):
    """按 word 去重：多次导入不双份。"""
    payload = {"cards": [{"word": "banana", "meaning": "香蕉", "kind": "word"}]}
    client.post("/api/import/cards", json=payload)
    client.post("/api/import/cards", json=payload)
    cards = db_session.query(Card).filter_by(word="banana").all()
    assert len(cards) == 1
