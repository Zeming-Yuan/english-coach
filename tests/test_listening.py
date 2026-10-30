"""听写练习 API 测试。"""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import select

from app.models.card import Card
from app.models.review import Review


def _seed_words(db, words=("apple", "book", "cat", "dog")):
    for word in words:
        db.add(Card(word=word, meaning=f"{word}的意思", kind="word"))
    db.commit()


def _listening_question(client):
    return client.get("/api/listening?limit=1").json()["questions"][0]


def _listening_payload(question, answer=None, **overrides):
    payload = {
        "card_id": question["card_id"],
        "question_token": question["question_token"],
        "source": "listening",
        "kind": "choice",
        "submission_id": str(uuid4()),
    }
    if answer is not None:
        payload["answer"] = answer
    payload.update(overrides)
    return payload


def _wrong_answer(question):
    return next(
        option for option in question["options"] if option != question["word"]
    )


def test_listening_empty(client):
    """空库 → 空题目。"""
    resp = client.get("/api/listening")
    assert resp.status_code == 200
    assert resp.json()["questions"] == []


def test_listening_new_cards(client, db_session):
    """新词（无 Review）→ 生成听写题。"""
    for w in ["apple", "banana", "cat", "dog", "egg", "fish", "grape", "hat"]:
        db_session.add(Card(word=w, meaning=f"{w}的意思", kind="word"))
    db_session.commit()

    resp = client.get("/api/listening?limit=3")
    data = resp.json()
    assert len(data["questions"]) == 3
    for q in data["questions"]:
        assert len(q["options"]) >= 2  # 至少正确+1干扰
        assert q["options"][q["correct_index"]] == q["word"]
        assert q["meaning"] is not None


def test_listening_due_cards(client, db_session):
    """到期卡 → 生成听写题。"""
    card = Card(word="hello", meaning="你好", kind="word")
    db_session.add(card)
    db_session.flush()
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    db_session.add(
        Review(
            card_id=card.id,
            state=1,
            due=now - timedelta(hours=1),
            stability=2.5,
            difficulty=0.3,
            elapsed_days=0,
            last_review=now - timedelta(days=1),
            review_count=1,
        )
    )
    # 干扰项来自全库词卡；给它们未来排期，避免进入今日队列
    for word in ["apple", "book", "cat"]:
        extra = Card(word=word, meaning=word, kind="word")
        db_session.add(extra)
        db_session.flush()
        db_session.add(
            Review(
                card_id=extra.id,
                state=1,
                due=now + timedelta(days=30),
                stability=2.5,
                difficulty=0.3,
                elapsed_days=0,
                last_review=now - timedelta(days=1),
                review_count=1,
            )
        )
    db_session.commit()

    resp = client.get("/api/listening")
    data = resp.json()
    assert len(data["questions"]) == 1
    assert data["questions"][0]["word"] == "hello"
    assert data["questions"][0]["question_token"]


def test_listening_small_library_full_options(client, db_session):
    """小词库（如 16 词）下每题仍有 3 个干扰项（旧逻辑 seen 排除整个池只剩 2 个）。"""
    for i in range(16):
        db_session.add(Card(word=f"w{i:02}", meaning=f"词{i}", kind="word"))
    db_session.commit()

    resp = client.get("/api/listening?limit=5")
    data = resp.json()
    assert len(data["questions"]) == 5
    for q in data["questions"]:
        assert len(q["options"]) == 4
        assert len(set(q["options"])) == 4  # 选项不重复
        assert q["options"][q["correct_index"]] == q["word"]


def test_listening_tiny_library_unique_options(client, db_session):
    """极小词库（3 词）：题目数减少给干扰项腾词，选项不重复。"""
    for w in ["apple", "banana", "cat"]:
        db_session.add(Card(word=w, meaning=f"{w}的意思", kind="word"))
    db_session.commit()

    resp = client.get("/api/listening?limit=5")
    data = resp.json()
    assert len(data["questions"]) >= 1
    for q in data["questions"]:
        assert len(set(q["options"])) == len(q["options"])  # 无重复选项
        assert q["options"][q["correct_index"]] == q["word"]


def test_listening_only_word_kind(client, db_session):
    """句子卡不进听写题。"""
    db_session.add(Card(word="hello", meaning="你好", kind="word"))
    db_session.add(Card(word="I am fine", meaning="我很好", kind="sentence"))
    for word in ["apple", "book", "cat"]:
        db_session.add(Card(word=word, meaning=word, kind="word"))
    db_session.commit()

    resp = client.get("/api/listening")
    data = resp.json()
    assert len(data["questions"]) == 1
    assert data["questions"][0]["word"] == "hello"


def test_listening_score_correct(client, db_session):
    """听写评分：服务端选对；识别题不排期。"""
    _seed_words(db_session, ("world", "apple", "book", "cat"))
    question = _listening_question(client)

    resp = client.post(
        "/api/listening/score",
        json=_listening_payload(question, question["word"]),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["correct"] is True
    assert data["correct_word"] == question["word"]
    assert data["scheduled"] is False
    assert data["next_due"] is None
    assert data["graduated"] is False


def test_listening_score_wrong(client, db_session):
    """听写评分：服务端选错，不写 FSRS。"""
    _seed_words(db_session, ("hello", "apple", "book", "cat"))
    question = _listening_question(client)

    resp = client.post(
        "/api/listening/score",
        json=_listening_payload(question, _wrong_answer(question)),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["correct"] is False
    assert data["correct_word"] == "hello"
    assert data["scheduled"] is False


def test_listening_score_card_not_found(client, db_session):
    """不存在的卡 → 404。"""
    _seed_words(db_session)
    question = _listening_question(client)
    resp = client.post(
        "/api/listening/score",
        json=_listening_payload(question, question["word"], card_id=999),
    )
    assert resp.status_code == 404


def test_listening_repeated_correct_answers_never_graduate(client, db_session):
    """识别练习不更新 FSRS，因此多次答对也不毕业、不生成句子卡。"""
    _seed_words(
        db_session, ("world", "apple", "book", "cat")
    )
    question = _listening_question(client)

    for _ in range(3):
        resp = client.post(
            "/api/listening/score",
            json=_listening_payload(question, question["word"]),
        )
        assert resp.status_code == 200
        assert resp.json()["graduated"] is False

    detail = client.get(f"/api/cards/{question['card_id']}").json()
    assert detail["memory_state"] is None
    assert len(detail["learning_events"]) == 3
    sentence = db_session.execute(
        select(Card).where(Card.word == "world", Card.kind == "sentence")
    ).scalars().first()
    assert sentence is None
