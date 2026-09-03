from sqlalchemy import select

from app.models.card import Card


def make_card(db, word="apple"):
    card = Card(word=word, meaning="苹果")
    db.add(card)
    db.commit()
    return card


def test_typing_correct(client, db_session):
    make_card(db_session)
    resp = client.post("/api/typing/check", json={"card_id": 1, "user_input": "apple"})
    data = resp.json()
    assert resp.status_code == 200
    assert data["correct"] is True
    assert data["expected"] == "apple"


def test_typing_case_insensitive(client, db_session):
    make_card(db_session)
    resp = client.post("/api/typing/check", json={"card_id": 1, "user_input": "Apple"})
    assert resp.json()["correct"] is True


def test_typing_wrong(client, db_session):
    make_card(db_session)
    resp = client.post("/api/typing/check", json={"card_id": 1, "user_input": "orange"})
    assert resp.json()["correct"] is False


def test_typing_card_not_found(client, db_session):
    resp = client.post("/api/typing/check", json={"card_id": 999, "user_input": "x"})
    assert resp.status_code == 404


def make_quiz_cards(db):
    """造 5 张带 meaning/example 的卡，模拟测验素材。"""
    for word, meaning, example in [
        ("apple", "苹果", "I like to eat an apple every day."),
        ("banana", "香蕉", "Monkeys love to eat bananas."),
        ("cherry", "樱桃", "She ate a cherry after lunch."),
        ("date", "枣子", "Dates are sweet fruits."),
        ("egg", "鸡蛋", "I had a boiled egg for breakfast."),
    ]:
        db.add(Card(word=word, meaning=meaning, example=example))
    db.commit()


def test_quiz_returns_five_questions(client, db_session):
    make_quiz_cards(db_session)
    data = client.get("/api/quiz").json()
    types = [q["type"] for q in data["questions"]]
    assert types == ["cn2en", "cn2en", "cn2en", "choice", "fill"]


def test_quiz_choice_options(client, db_session):
    make_quiz_cards(db_session)
    data = client.get("/api/quiz").json()
    choice = next(q for q in data["questions"] if q["type"] == "choice")
    assert len(choice["options"]) == 4
    assert len(set(choice["options"])) == 4  # 无重复选项
    answer = db_session.get(Card, choice["card_id"]).word
    assert answer in choice["options"]  # 正确答案在选项中


def test_quiz_fill_prompt_blanks_word(client, db_session):
    make_quiz_cards(db_session)
    data = client.get("/api/quiz").json()
    fill = next(q for q in data["questions"] if q["type"] == "fill")
    assert "___" in fill["prompt"]


def test_quiz_empty_db(client, db_session):
    data = client.get("/api/quiz")
    assert data.status_code == 200
    assert data.json()["questions"] == []


def test_quiz_score_three_of_five(client, db_session):
    make_quiz_cards(db_session)
    cards = db_session.execute(select(Card).order_by(Card.id)).scalars().all()
    answers = [
        {"card_id": c.id, "user_input": c.word if i < 3 else "wrong"}
        for i, c in enumerate(cards)
    ]
    resp = client.post("/api/quiz/score", json={"answers": answers})
    data = resp.json()
    assert data["total"] == 5
    assert data["correct"] == 3
    assert data["score"] == 60


def test_quiz_score_case_and_punctuation_ok(client, db_session):
    make_quiz_cards(db_session)
    card = db_session.execute(select(Card)).scalars().first()
    resp = client.post(
        "/api/quiz/score",
        json={"answers": [{"card_id": card.id, "user_input": "Apple,"}]},
    )
    assert resp.json()["correct"] == 1


def test_quiz_score_empty_answers(client):
    resp = client.post("/api/quiz/score", json={"answers": []})
    data = resp.json()
    assert data["total"] == 0
    assert data["score"] == 0  # 除零保护


def test_quiz_score_unknown_card_skipped(client, db_session):
    make_quiz_cards(db_session)
    resp = client.post(
        "/api/quiz/score",
        json={"answers": [{"card_id": 999, "user_input": "apple"}]},
    )
    assert resp.json()["total"] == 1
    assert resp.json()["correct"] == 0  # 卡不存在：跳过不计


def test_choice_endpoint_returns_only_choice(client, db_session):
    """/quiz/choice：全部是 choice 型，题数=limit，每题 4 个不重选项。"""
    make_quiz_cards(db_session)
    data = client.get("/api/quiz/choice?limit=3").json()
    questions = data["questions"]
    assert len(questions) == 3
    assert all(q["type"] == "choice" for q in questions)
    for q in questions:
        assert len(q["options"]) == 4
        assert len(set(q["options"])) == 4  # 无重复选项
        answer = db_session.get(Card, q["card_id"]).word
        assert answer in q["options"]  # 正确答案在选项中


def test_choice_endpoint_empty_db(client, db_session):
    data = client.get("/api/quiz/choice").json()
    assert data["questions"] == []


def test_quiz_excludes_sentence_cards(client, db_session):
    """测验只抽单词卡：句子卡不进入 cn2en/choice（释义是整句翻译）。"""
    db_session.add(Card(word="apple", meaning="苹果", kind="word"))
    db_session.add(Card(word="apple", meaning="我吃一个苹果。", kind="sentence"))
    db_session.commit()
    resp = client.get("/api/quiz?limit=5")
    questions = resp.json()["questions"]
    assert len(questions) >= 1
    # 所有题要么来自 word 卡（word_length 与释义匹配），且无句子卡整句释义
    for q in questions:
        if q["type"] in ("cn2en", "fill"):
            assert q.get("word_length") < 20
