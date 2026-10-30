"""EC-06 识别题：服务端判分、题目上下文与原子批次。

Review Focus：
RF1 伪造 correct_index 不能造正确；
RF2 题目过期后已成功提交仍可幂等回放；
RF3 相关词答案不同于原词；
RF4 干扰项不足不造单选假题；
RF5 批次一个坏项导致全批回滚。
"""

from uuid import uuid4

import pytest


def test_listening_is_server_graded_without_scheduling(ec):
    for word in ["apple", "book", "cat", "dog"]:
        ec.seed_card(word=word, meaning=word)
    question = ec.client.get("/api/listening?limit=1").json()["questions"][0]
    response = ec.client.post(
        "/api/listening/score",
        json={
            "card_id": question["card_id"],
            "answer": "not-an-option",
            "question_token": question["question_token"],
            "source": "listening",
            "kind": "choice",
            "correct_index": 0,
            "selected_index": 0,
            "submission_id": str(uuid4()),
        },
    )
    assert response.status_code == 422


def _seed_words(ec, words=("apple", "book", "cat", "dog")):
    for word in words:
        ec.seed_card(word=word, meaning=word)


def _listening_question(ec):
    return ec.client.get("/api/listening?limit=1").json()["questions"][0]


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


def test_listening_grades_by_answer_text_not_correct_index(ec):
    """RF1：伪造正确下标不能造正确，文本答案才是服务端判分依据。"""
    _seed_words(ec)
    question = _listening_question(ec)
    correct_answer = question["word"]
    wrong_answer = next(
        option for option in question["options"] if option != correct_answer
    )
    correct_index = question["options"].index(correct_answer)

    forged = ec.client.post(
        "/api/listening/score",
        json=_listening_payload(
            question,
            wrong_answer,
            correct_index=correct_index,
            selected_index=correct_index,
        ),
    )
    assert forged.status_code == 200
    assert forged.json()["correct"] is False

    honest = ec.client.post(
        "/api/listening/score",
        json=_listening_payload(
            question,
            correct_answer,
            correct_index=(correct_index + 1) % len(question["options"]),
            selected_index=(correct_index + 1) % len(question["options"]),
        ),
    )
    assert honest.status_code == 200
    assert honest.json()["correct"] is True


def test_listening_recognition_does_not_schedule(ec):
    _seed_words(ec)
    question = _listening_question(ec)
    response = ec.client.post(
        "/api/listening/score",
        json=_listening_payload(question, question["word"]),
    )
    assert response.status_code == 200
    data = response.json()
    assert data["correct"] is True
    assert data["correct_word"] == question["word"]
    assert data["scheduled"] is False
    assert data["next_due"] is None
    assert data["graduated"] is False

    detail = ec.client.get(f"/api/cards/{question['card_id']}").json()
    assert detail["memory_state"] is None
    assert len(detail["learning_events"]) == 1
    event = detail["learning_events"][0]
    assert event["scheduled"] is False
    assert event["correct"] is True
    assert event["source"] == "listening"
    assert event["kind"] == "choice"


def test_listening_skip_records_empty_correct(ec):
    _seed_words(ec)
    question = _listening_question(ec)
    response = ec.client.post(
        "/api/listening/score",
        json=_listening_payload(question, skipped=True),
    )
    assert response.status_code == 200
    data = response.json()
    assert data["correct"] is None
    assert data["scheduled"] is False

    detail = ec.client.get(f"/api/cards/{question['card_id']}").json()
    event = detail["learning_events"][0]
    assert event["skipped"] is True
    assert event["correct"] is None
    assert event["scheduled"] is False
    assert detail["memory_state"] is None


def test_same_listening_submission_is_recorded_once(ec):
    """同一选择不能被记录两次：事件与错词权重都只变化一次。"""
    _seed_words(ec)
    question = _listening_question(ec)
    wrong_answer = next(
        option for option in question["options"] if option != question["word"]
    )
    payload = _listening_payload(question, wrong_answer)

    first = ec.client.post("/api/listening/score", json=payload)
    second = ec.client.post("/api/listening/score", json=payload)
    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()

    detail = ec.client.get(f"/api/cards/{question['card_id']}").json()
    assert len(detail["learning_events"]) == 1
    assert detail["error_count"] == 1


def test_tampered_question_token_is_rejected(ec):
    _seed_words(ec)
    question = _listening_question(ec)
    token = question["question_token"]
    tampered = token[:-1] + ("0" if token[-1] != "0" else "1")

    response = ec.client.post(
        "/api/listening/score",
        json=_listening_payload(
            question, question["word"], question_token=tampered
        ),
    )
    assert response.status_code == 422
    detail = ec.client.get(f"/api/cards/{question['card_id']}").json()
    assert detail["learning_events"] == []


def test_expired_question_token_is_rejected_before_first_save(ec):
    _seed_words(ec)
    question = _listening_question(ec)
    ec.set_time("2026-10-31T13:00:00+00:00")  # token 签发后 25 小时

    response = ec.client.post(
        "/api/listening/score",
        json=_listening_payload(question, question["word"]),
    )
    assert response.status_code == 409
    detail = ec.client.get(f"/api/cards/{question['card_id']}").json()
    assert detail["learning_events"] == []


def test_successful_submission_replays_after_expiry(ec):
    """RF2：已成功提交的原 token 过期后仍按原标识回放，不再失败/重复。"""
    _seed_words(ec)
    question = _listening_question(ec)
    payload = _listening_payload(question, question["word"])
    first = ec.client.post("/api/listening/score", json=payload)
    assert first.status_code == 200

    ec.set_time("2026-10-31T13:00:00+00:00")
    replay = ec.client.post("/api/listening/score", json=payload)
    assert replay.status_code == 200
    assert replay.json() == first.json()

    detail = ec.client.get(f"/api/cards/{question['card_id']}").json()
    assert len(detail["learning_events"]) == 1


def test_restart_invalidates_old_question_token(ec):
    _seed_words(ec)
    question = _listening_question(ec)
    payload = _listening_payload(question, question["word"])

    ec.restart()
    response = ec.client.post("/api/listening/score", json=payload)
    assert response.status_code == 409

    detail = ec.client.get(f"/api/cards/{question['card_id']}").json()
    assert detail["learning_events"] == []


def test_same_submission_id_with_different_answer_conflicts(ec):
    _seed_words(ec)
    question = _listening_question(ec)
    other_answer = next(
        option for option in question["options"] if option != question["word"]
    )
    payload = _listening_payload(question, question["word"])
    assert ec.client.post("/api/listening/score", json=payload).status_code == 200

    changed = {**payload, "answer": other_answer}
    response = ec.client.post("/api/listening/score", json=changed)
    assert response.status_code == 409

    detail = ec.client.get(f"/api/cards/{question['card_id']}").json()
    assert len(detail["learning_events"]) == 1
    assert detail["error_count"] == 0


def _choice_questions(ec, limit=1):
    return ec.client.get(f"/api/quiz/choice?limit={limit}").json()["questions"]


def _quiz_payload(question, answer, **overrides):
    payload = {
        "card_id": question["card_id"],
        "answer": answer,
        "question_token": question["question_token"],
        "source": "quiz",
        "kind": "choice",
        "submission_id": str(uuid4()),
    }
    payload.update(overrides)
    return payload


def _post_batch(ec, answers):
    return ec.client.post("/api/quiz/score", json={"answers": answers})


def _wrong_answer(ec, question):
    word = ec.client.get(f"/api/cards/{question['card_id']}").json()["word"]
    return next(option for option in question["options"] if option != word)


def test_quiz_choice_is_graded_by_server_context(ec):
    _seed_words(ec)
    question = _choice_questions(ec)[0]
    assert question["question_token"]
    correct_answer = next(
        option
        for option in question["options"]
        if option == ec.client.get(f"/api/cards/{question['card_id']}").json()["word"]
    )
    wrong_answer = next(
        option for option in question["options"] if option != correct_answer
    )

    forged = _post_batch(
        ec,
        [
            _quiz_payload(
                question,
                wrong_answer,
                correct_index=question["options"].index(correct_answer),
            )
        ],
    )
    assert forged.status_code == 200
    assert forged.json()["correct"] == 0

    honest = _post_batch(ec, [_quiz_payload(question, correct_answer)])
    assert honest.status_code == 200
    assert honest.json()["correct"] == 1
    assert honest.json()["score"] == 100
    assert honest.json()["details"][0]["scheduled"] is False

    detail = ec.client.get(f"/api/cards/{question['card_id']}").json()
    assert all(event["scheduled"] is False for event in detail["learning_events"])
    assert detail["memory_state"] is None


def test_quiz_batch_is_atomic_when_one_item_is_invalid(ec):
    _seed_words(ec)
    first, second = _choice_questions(ec, limit=2)
    broken_token = second["question_token"][:-1] + (
        "0" if second["question_token"][-1] != "0" else "1"
    )
    response = _post_batch(
        ec,
        [
            _quiz_payload(first, first["options"][0]),
            _quiz_payload(second, second["options"][0], question_token=broken_token),
        ],
    )
    assert response.status_code == 422

    for question in (first, second):
        detail = ec.client.get(f"/api/cards/{question['card_id']}").json()
        assert detail["learning_events"] == []

    valid = _post_batch(
        ec,
        [
            _quiz_payload(first, _wrong_answer(ec, first)),
            _quiz_payload(second, _wrong_answer(ec, second)),
        ],
    )
    assert valid.status_code == 200
    data = valid.json()
    assert data["total"] == 2
    assert data["correct"] == 0  # 选项文本随机，不能假设第 0 项正确
    assert data["score"] == 0
    assert len(data["details"]) == 2
    for question in (first, second):
        detail = ec.client.get(f"/api/cards/{question['card_id']}").json()
        assert len(detail["learning_events"]) == 1
        assert detail["learning_events"][0]["scheduled"] is False


def test_quiz_batch_conflict_rolls_back_new_items(ec):
    _seed_words(ec)
    first, second = _choice_questions(ec, limit=2)
    first_payload = _quiz_payload(first, first["options"][0])
    assert _post_batch(ec, [first_payload]).status_code == 200

    other_answer = next(
        option for option in first["options"] if option != first["options"][0]
    )
    response = _post_batch(
        ec,
        [
            _quiz_payload(second, second["options"][0]),
            {**first_payload, "answer": other_answer},
        ],
    )
    assert response.status_code == 409

    first_detail = ec.client.get(f"/api/cards/{first['card_id']}").json()
    second_detail = ec.client.get(f"/api/cards/{second['card_id']}").json()
    assert len(first_detail["learning_events"]) == 1
    assert second_detail["learning_events"] == []


def test_quiz_related_uses_related_answer_not_original_word(ec):
    """RF3：相关词题以题目上下文中的 related 答案判分。"""
    for i in range(6):
        ec.seed_card(
            word=f"word{i}",
            meaning=f"meaning{i}",
            related_words=[{"word": f"rel{i}", "meaning": f"related-{i}"}],
        )
    questions = ec.client.get("/api/quiz?limit=6").json()["questions"]
    related = next(q for q in questions if q["type"] == "related")
    assert related["question_token"]
    assert related["options"]

    detail_card = ec.client.get(f"/api/cards/{related['card_id']}").json()
    related_answers = {item["word"] for item in detail_card["related_words"]}
    assert detail_card["word"] not in related_answers

    outcomes = {}
    for option in related["options"]:
        response = _post_batch(
            ec,
            [_quiz_payload(related, option, kind="related")],
        )
        assert response.status_code == 200
        outcomes[option] = response.json()["details"][0]["correct"]
    accepted = [option for option, correct in outcomes.items() if correct]
    assert len(accepted) == 1
    assert accepted[0] in related_answers
    assert accepted[0] != detail_card["word"]


def test_single_word_library_issues_no_choice_questions(ec):
    """RF4：无法形成有效选项时不发出虚假的选择题。"""
    ec.seed_card(word="solo", meaning="单独")
    assert _choice_questions(ec) == []
    assert ec.client.get("/api/listening").json()["questions"] == []


@pytest.mark.parametrize(
    "mutation",
    [
        {"question_token": "broken"},
        {"question_token": None},
        {"answer": "not-an-option"},
        {"card_id": 999999},
        {"kind": "unsupported"},
        {"assistance": ["unsupported"]},
    ],
)
def test_recognition_review_focus_rejects_bad_context(ec, mutation):
    _seed_words(ec)
    question = _choice_questions(ec)[0]
    payload = _quiz_payload(question, question["options"][0])
    payload.update(mutation)
    if "question_token" in mutation and mutation["question_token"] is None:
        payload.pop("question_token", None)
    response = _post_batch(ec, [payload])
    assert response.status_code in (404, 422)

    detail = ec.client.get(f"/api/cards/{question['card_id']}").json()
    assert detail["learning_events"] == []


@pytest.mark.parametrize(
    "mutation",
    [
        {"rating": 3},
        {"kind": "self_rating", "rating": 3},
        {"source": "quiz"},
    ],
)
def test_listening_rejects_client_override(ec, mutation):
    """客户端额外评分/来源不能覆盖识别题策略。"""
    _seed_words(ec)
    question = _listening_question(ec)
    response = ec.client.post(
        "/api/listening/score",
        json=_listening_payload(question, question["word"], **mutation),
    )
    assert response.status_code == 422
    detail = ec.client.get(f"/api/cards/{question['card_id']}").json()
    assert detail["learning_events"] == []


def test_listening_requires_question_context(ec):
    _seed_words(ec)
    question = _listening_question(ec)
    payload = _listening_payload(question, question["word"])
    payload.pop("question_token")
    response = ec.client.post("/api/listening/score", json=payload)
    assert response.status_code == 422
    detail = ec.client.get(f"/api/cards/{question['card_id']}").json()
    assert detail["learning_events"] == []


def test_empty_batch_preserves_legacy_response(ec):
    response = _post_batch(ec, [])
    assert response.status_code == 200
    assert response.json() == {
        "total": 0,
        "correct": 0,
        "score": 0,
        "details": [],
    }


def test_batch_unknown_card_writes_nothing(ec):
    _seed_words(ec)
    question = _choice_questions(ec)[0]
    response = _post_batch(
        ec,
        [
            _quiz_payload(question, _wrong_answer(ec, question)),
            _quiz_payload(question, question["options"][0], card_id=999999),
        ],
    )
    assert response.status_code == 404
    detail = ec.client.get(f"/api/cards/{question['card_id']}").json()
    assert detail["learning_events"] == []
