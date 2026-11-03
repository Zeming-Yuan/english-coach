"""EL-15: scene-specific tasks through public HTTP and complete backups."""

from uuid import uuid4


def create_scene(ec, scene_id="introduction", session_id=None):
    return ec.client.post(
        "/api/practice-sessions",
        json={
            "id": session_id or str(uuid4()),
            "purpose": "scene",
            "scene_id": scene_id,
        },
    )


def test_el15_introduction_uses_three_specific_tasks(ec):
    response = create_scene(ec)
    assert response.status_code == 200, response.text
    assert [item["task_key"] for item in response.json()["items"]] == [
        "name",
        "origin",
        "preference",
    ]


def test_el15_directions_has_a_fictional_context_and_three_distinct_tasks(ec):
    response = create_scene(ec, "directions")
    assert response.status_code == 200, response.text
    run = response.json()
    assert [i["task_key"] for i in run["items"]] == [
        "destination",
        "direction",
        "confirmation",
    ]
    assert "虚构" in run["situation"]
    assert "左" in run["situation"]
    assert "Should I turn left?" not in str(run)


def answer(ec, run, index, text=None, submission_id=None, **extra):
    return ec.client.post(
        f"/api/practice-sessions/{run['id']}/items/{run['items'][index]['id']}/attempts",
        json={"submission_id": submission_id or str(uuid4()), "answer": text, **extra},
    )


def test_el15_ambiguous_name_slot_does_not_pass(ec):
    run = create_scene(ec).json()
    result = answer(ec, run, 0, "My name is unknown")
    assert result.status_code == 200, result.text
    assert result.json()["verdict"] == "unknown"


import pytest


@pytest.mark.parametrize(
    "scene_id,word,texts,context",
    [
        (
            "introduction",
            "tea",
            ["My name is 李", "I am from 北京", "I like tea."],
            "introduction:meeting-over-tea",
        ),
        (
            "directions",
            "station",
            [
                "Excuse me, where is the station?",
                "Should I turn left?",
                "Yes, thank you.",
            ],
            "directions:fictional-station-left",
        ),
    ],
)
def test_el15_independent_results_only_map_scene_targets(
    ec, scene_id, word, texts, context
):
    target = ec.seed_card(word=word, meaning="目标")
    untouched = ec.seed_card(word="李", meaning="姓名槽位")
    run = create_scene(ec, scene_id).json()
    result = None
    for index, text in enumerate(texts):
        result = answer(ec, run, index, text)
        assert result.status_code == 200, result.text
        assert result.json()["verdict"] == "accepted"
    assert result is not None
    assert result.json()["session"]["status"] == "independent"
    backup = ec.client.get("/api/export/backup").json()
    mappings = [
        t for a in backup["extensions"]["scene_attempts"] for t in a["target_mapping"]
    ]
    assert {t["context"] for t in mappings} == {context}
    assert {t["word"] for t in mappings} == {word}
    assert (
        ec.client.get(f"/api/cards/{target}").json()["learning_evidence"][
            "application"
        ]["status"]
        == "verified"
    )
    assert (
        ec.client.get(f"/api/cards/{untouched}").json()["learning_evidence"][
            "application"
        ]["status"]
        == "insufficient"
    )
    assert backup["learning_events"] == backup["reviews"] == []


def test_el15_catalog_has_separate_preparation_and_resume_identity(ec):
    ec.seed_card(word="tea", meaning="茶")
    intro = create_scene(ec).json()
    directions = create_scene(ec, "directions").json()
    catalog = ec.client.get("/api/scenes").json()["scenes"]
    assert [s["id"] for s in catalog] == ["drinks", "introduction", "directions"]
    by_id = {s["id"]: s for s in catalog}
    assert by_id["drinks"]["session_id"] is None
    assert by_id["introduction"]["session_id"] == intro["id"]
    assert by_id["directions"]["session_id"] == directions["id"]
    assert by_id["introduction"]["preparation"]["targets"][0]["meaning"] == "茶"
    assert by_id["introduction"]["preparation"]["missing_words"] == []
    assert by_id["directions"]["preparation"]["missing_words"] == [
        "station",
        "left",
        "thank",
    ]
    assert create_scene(ec, "../drinks").status_code == 404


@pytest.mark.parametrize(
    "scene_id,text",
    [
        ("introduction", "My name is O’Connor"),
        ("directions", "Excuse me, where is the station?"),
    ],
)
def test_el15_v3_restores_original_scene_and_replays_submission(
    ec, ec_factory, scene_id, text
):
    from tests.test_el11_bounded_personalized_story import restore

    ec.seed_card(word="tea", meaning="茶")
    ec.seed_card(word="station", meaning="车站")
    run = create_scene(ec, scene_id).json()
    submission_id = str(uuid4())
    saved = answer(ec, run, 0, text, submission_id)
    assert saved.status_code == 200, saved.text
    backup = ec.client.get("/api/export/backup").json()
    target = ec_factory()
    target.seed_card(word="retired")
    restore(target, backup)
    reopened = target.client.get(f"/api/practice-sessions/{run['id']}").json()
    assert reopened["scene_id"] == scene_id
    assert reopened["counts"]["processed"] == 1
    assert answer(target, reopened, 0, text, submission_id).json() == saved.json()
    assert target.client.get("/api/export/backup").json()["cards"][0]["id"] != 1


def test_el15_failure_does_not_overwrite_another_scene_context(ec):
    card_id = ec.seed_card(word="thank", meaning="感谢")
    for scene_id, texts in [
        ("drinks", ["Can I have water, please?", "one", "Yes, thank you."]),
        (
            "directions",
            ["Excuse me, where is the station?", "Should I turn left?", "no"],
        ),
    ]:
        run = create_scene(ec, scene_id).json()
        for index, text in enumerate(texts):
            assert answer(ec, run, index, text).status_code == 200
    application = ec.client.get(f"/api/cards/{card_id}").json()["learning_evidence"][
        "application"
    ]
    assert application["status"] == "verified"
    contexts = {c["context"]: c for c in application["contexts"]}
    assert contexts["drinks:water-order"]["status"] == "verified"
    assert contexts["directions:fictional-station-left"]["status"] == "weak"


@pytest.mark.parametrize(
    "scene_id,expected",
    [
        ("drinks", ["request", "quantity", "confirm"]),
        ("introduction", ["name", "origin", "preference"]),
        ("directions", ["destination", "direction", "confirmation"]),
    ],
)
def test_el15_task_query_returns_each_scenes_own_fixed_tasks(scene_id, expected):
    from app.services.scenes import scene_tasks

    assert scene_tasks(scene_id) == expected
