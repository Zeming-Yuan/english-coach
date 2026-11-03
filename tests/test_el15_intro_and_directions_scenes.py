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


def test_el15_registered_rule_version_can_be_loaded_without_changing_identity():
    from app.services.scenes import scene_rules

    original = scene_rules("introduction", rule_version="introduction-v1")
    assert original["rule_version"] == "introduction-v1"
    assert original["content_revision"] == 1
    assert scene_rules("introduction")["rule_version"] == "introduction-v4"


def test_el15_rule_upgrade_keeps_old_results_replayable_and_restorable(
    ec, ec_factory, tmp_path, monkeypatch
):
    import json

    from app.services.scenes import SCENE_RULE_FILES, scene_rules
    from tests.test_el11_bounded_personalized_story import restore

    card_id = ec.seed_card(word="tea", meaning="茶")
    run = create_scene(ec).json()
    old_version = run["rule_version"]
    submission_id = str(uuid4())
    saved = answer(ec, run, 0, "My name is 李", submission_id).json()
    for index, text in [(1, "I am from 北京"), (2, "I like tea.")]:
        assert answer(ec, run, index, text).status_code == 200
    backup = ec.client.get("/api/export/backup").json()
    revised = scene_rules("introduction")
    revised.pop("content_hash")
    revised.update(
        rule_version="introduction-next-test",
        content_revision=revised["content_revision"] + 1,
    )
    revised["tasks"][0]["goal"] = "用完整句式向新同学介绍自己的姓名"
    material = tmp_path / "introduction-next-test.json"
    material.write_text(json.dumps(revised))
    monkeypatch.setitem(
        SCENE_RULE_FILES,
        "introduction",
        {
            **SCENE_RULE_FILES["introduction"],
            "introduction-next-test": str(material),
        },
    )
    reopened = ec.client.get(f"/api/practice-sessions/{run['id']}").json()
    assert reopened["rule_version"] == old_version
    assert reopened["can_continue"] is False
    assert reopened["counts"]["processed"] == 3
    assert answer(ec, run, 0, "My name is 李", submission_id).json() == saved
    assert answer(ec, run, 0, "My name is 李").status_code == 409
    evidence = ec.client.get(f"/api/cards/{card_id}").json()["learning_evidence"][
        "application"
    ]
    assert evidence["status"] == "stale"
    assert evidence["contexts"][0]["rule_version"] == old_version
    target = ec_factory()
    restore(target, backup)
    assert (
        target.client.get(f"/api/practice-sessions/{run['id']}").json()["rule_version"]
        == old_version
    )
    assert answer(target, run, 0, "My name is 李", submission_id).json() == saved
    assert create_scene(target).json()["rule_version"] == "introduction-next-test"


@pytest.mark.parametrize(
    "damage",
    [
        "duplicate_task",
        "missing_turn",
        "missing_mapping",
        "answer_in_role",
        "answer_embedded_in_role",
        "wrong_version",
        "wrong_scene",
    ],
)
def test_el15_registry_rejects_invalid_distributed_material(
    tmp_path, monkeypatch, damage
):
    import json

    from app.services.scenes import SCENE_RULE_FILES, scene_rules

    material = scene_rules("introduction")
    material.pop("content_hash")
    version = material["rule_version"]
    if damage == "duplicate_task":
        material["tasks"][1]["task_key"] = "name"
    elif damage == "missing_turn":
        material["tasks"].pop()
    elif damage == "missing_mapping":
        material["tasks"][0].pop("target_words")
    elif damage == "answer_in_role":
        material["tasks"][0]["role"] = material["tasks"][0]["standard"]
    elif damage == "answer_embedded_in_role":
        material["tasks"][0]["role"] = "参考：" + material["tasks"][0]["standard"]
    elif damage == "wrong_version":
        material["rule_version"] = "unregistered-v9"
    else:
        material["scene_id"] = "directions"
    path = tmp_path / "invalid.json"
    path.write_text(json.dumps(material))
    monkeypatch.setitem(SCENE_RULE_FILES, "introduction", {version: str(path)})
    with pytest.raises(ValueError, match="场景材料"):
        scene_rules("introduction")


def test_el15_expansion_rollback_preserves_drinks_and_saved_new_scenes(ec):
    run = create_scene(ec).json()
    ec.settings.scene_expansions_enabled = False
    ec.restart()
    assert create_scene(ec).status_code == 403
    assert create_scene(ec, "directions").status_code == 403
    assert create_scene(ec, "drinks").status_code == 200
    assert create_scene(ec, session_id=run["id"]).status_code == 200
    assert answer(ec, run, 0, "My name is 李").status_code == 200
    assert ec.client.get(f"/api/practice-sessions/{run['id']}").status_code == 200
    catalog = {s["id"]: s for s in ec.client.get("/api/scenes").json()["scenes"]}
    assert catalog["drinks"]["enabled"] is True
    assert catalog["introduction"]["enabled"] is False
    assert catalog["introduction"]["session_id"] == run["id"]
    backup = ec.client.get("/api/export/backup").json()
    assert ec.client.post("/api/import/preview", json=backup).status_code == 200
    ec.settings.scene_expansions_enabled = True
    ec.restart()
    assert create_scene(ec).status_code == 200


@pytest.mark.parametrize(
    "scene_id,index,text,expected",
    [
        ("introduction", 0, "My name is 李", "accepted"),
        ("introduction", 0, "I'm O’Connor", "accepted"),
        ("introduction", 0, "My name is Jean-Luc", "accepted"),
        ("introduction", 0, "My name is", "rejected"),
        ("introduction", 0, "My name is ???", "rejected"),
        ("introduction", 0, "My name is 123", "unknown"),
        ("introduction", 0, "My name is I am", "unknown"),
        ("introduction", 1, "I come from New York", "accepted"),
        ("introduction", 1, "I'm from 北京", "accepted"),
        ("introduction", 1, "I am from", "rejected"),
        ("introduction", 1, "I am from here or there", "unknown"),
        ("introduction", 2, "I enjoy drinking tea", "accepted"),
        ("introduction", 2, "I don't like tea", "rejected"),
        ("introduction", 2, "I like music", "unknown"),
        ("directions", 0, "Could you tell me where the station is?", "accepted"),
        ("directions", 0, "station", "rejected"),
        ("directions", 0, "Excuse me, where is the school?", "rejected"),
        ("directions", 1, "So I turn left, is that right?", "accepted"),
        ("directions", 1, "Should I turn right?", "rejected"),
        ("directions", 1, "Should I turn left or right?", "unknown"),
        ("directions", 1, "Perhaps left, perhaps right", "unknown"),
        ("directions", 2, "Got it, thanks", "accepted"),
        ("directions", 2, "Thank you", "rejected"),
    ],
)
def test_el15_reviewed_expression_and_slot_boundaries(
    ec, scene_id, index, text, expected
):
    run = create_scene(ec, scene_id).json()
    for previous in range(index):
        assert answer(ec, run, previous, skipped=True).status_code == 200
    response = answer(ec, run, index, text)
    assert response.status_code == 200, response.text
    assert response.json()["verdict"] == expected


SCENARIOS = [
    ("introduction", "tea", ["My name is 李", "I am from 北京", "I like tea."]),
    (
        "directions",
        "station",
        ["Excuse me, where is the station?", "Should I turn left?", "Yes, thank you."],
    ),
]


@pytest.mark.parametrize("scene_id,word,texts", SCENARIOS)
def test_el15_assistance_skip_and_retry_keep_the_original_first_answer(
    ec, scene_id, word, texts
):
    ec.seed_card(word=word, meaning="目标")
    run = create_scene(ec, scene_id).json()
    url = f"/api/practice-sessions/{run['id']}/items/{run['items'][0]['id']}/assistance"
    helped = ec.client.post(url, json={"kind": "answer_visible"})
    assert helped.status_code == 200
    assert helped.json()["items"][0]["standard"]
    assert answer(ec, run, 0, "").status_code == 422
    first = answer(ec, run, 0, skipped=True)
    assert first.status_code == 200
    retry = answer(ec, run, 0, texts[0]).json()
    assert retry["verdict"] == "accepted"
    assert retry["first_response"] is False
    assert retry["session"]["items"][0]["skipped"] is True
    assert "answer_visible" in retry["session"]["items"][0]["assistance"]
    for index in [1, 2]:
        assert answer(ec, run, index, texts[index]).status_code == 200
    resumed = ec.client.get(f"/api/practice-sessions/{run['id']}").json()
    assert resumed["status"] == "completed"
    assert resumed["application_verified"] is False


@pytest.mark.parametrize("scene_id,word,texts", SCENARIOS)
def test_el15_failed_commits_and_concurrent_retries_save_one_submission(
    ec, scene_id, word, texts
):
    from concurrent.futures import ThreadPoolExecutor

    session_id = str(uuid4())
    before = ec.snapshot()
    ec.fail_commit_once()
    assert create_scene(ec, scene_id, session_id).status_code == 500
    assert ec.snapshot() == before
    run = create_scene(ec, scene_id, session_id).json()
    after_create = ec.snapshot()
    assert create_scene(ec, scene_id, session_id).status_code == 200
    assert ec.snapshot() == after_create
    submission_id = str(uuid4())
    ec.fail_commit_once()
    assert answer(ec, run, 0, texts[0], submission_id).status_code == 500
    assert ec.snapshot() == after_create
    with ThreadPoolExecutor(max_workers=2) as pool:
        saved = list(
            pool.map(lambda _: answer(ec, run, 0, texts[0], submission_id), range(2))
        )
    assert [r.status_code for r in saved] == [200, 200]
    assert saved[0].json() == saved[1].json()
    assert answer(ec, run, 0, "different", submission_id).status_code == 409
    other = create_scene(ec, "drinks").json()
    assert answer(ec, other, 0, "Can I have water?", submission_id).status_code == 409
    assert (
        ec.client.post(
            f"/api/practice-sessions/{other['id']}/items/{run['items'][0]['id']}/attempts",
            json={"submission_id": str(uuid4()), "answer": texts[0]},
        ).status_code
        == 404
    )
    backup = ec.client.get("/api/export/backup").json()
    assert len(backup["extensions"]["scene_attempts"]) == 1
    assert backup["learning_events"] == backup["reviews"] == []


@pytest.mark.parametrize("change", ["revision", "deletion"])
@pytest.mark.parametrize("scene_id,word,texts", SCENARIOS)
def test_el15_target_changes_stop_new_answers_but_keep_original_replay(
    ec, scene_id, word, texts, change
):
    card_id = ec.seed_card(word=word, meaning="目标")
    run = create_scene(ec, scene_id).json()
    submission_id = str(uuid4())
    saved = answer(ec, run, 0, texts[0], submission_id).json()
    changed = (
        ec.client.put(f"/api/cards/{card_id}", json={"meaning": "新释义"})
        if change == "revision"
        else ec.client.delete(f"/api/cards/{card_id}")
    )
    assert changed.status_code == 200
    assert answer(ec, run, 0, texts[0], submission_id).json() == saved
    assert answer(ec, run, 1, texts[1]).status_code == (
        409 if change == "revision" else 404
    )
    resumed = ec.client.get(f"/api/practice-sessions/{run['id']}").json()
    assert resumed["can_continue"] is False
    assert resumed["counts"]["processed"] == 1
    backup = ec.client.get("/api/export/backup").json()
    assert ec.client.post("/api/import/preview", json=backup).status_code == 200


@pytest.mark.parametrize(
    "damage", ["scene", "version", "context", "target", "cached_scene"]
)
def test_el15_v3_rejects_forged_scene_scope_before_writing(ec, damage):
    ec.seed_card(word="station", meaning="车站")
    run = create_scene(ec, "directions").json()
    assert answer(ec, run, 0, "Excuse me, where is the station?").status_code == 200
    backup = ec.client.get("/api/export/backup").json()
    practice = backup["extensions"]["practice_sessions"][0]
    attempt = backup["extensions"]["scene_attempts"][0]
    if damage == "scene":
        practice["scene_id"] = "introduction"
    elif damage == "version":
        practice["rule_version"] = "directions-v99"
    elif damage == "context":
        attempt["target_mapping"][0]["context"] = "drinks:water-order"
    elif damage == "target":
        attempt["target_mapping"][0]["word"] = "tea"
    else:
        attempt["response"]["session"]["scene_id"] = "introduction"
    before = ec.snapshot()
    assert ec.client.post("/api/import/preview", json=backup).status_code == 422
    assert ec.snapshot() == before


@pytest.mark.parametrize(
    "version,index,text",
    [
        ("introduction-v1", 0, "My name is I am"),
        ("introduction-v2", 1, "I am from I am"),
        ("introduction-v3", 1, "I am from I'm"),
    ],
)
def test_el15_old_verdict_restores_without_rejudging_under_current_rules(
    ec, ec_factory, monkeypatch, version, index, text
):
    from app.services.scenes import SCENE_RULE_FILES
    from tests.test_el11_bounded_personalized_story import restore

    versions = SCENE_RULE_FILES["introduction"]
    with monkeypatch.context() as old_release:
        old_release.setitem(
            SCENE_RULE_FILES, "introduction", {version: versions[version]}
        )
        run = create_scene(ec).json()
        if index:
            assert answer(ec, run, 0, "My name is 李").status_code == 200
        submission_id = str(uuid4())
        saved = answer(ec, run, index, text, submission_id).json()
        assert saved["verdict"] == "accepted"
        backup = ec.client.get("/api/export/backup").json()
    target = ec_factory()
    restore(target, backup)
    reopened = target.client.get(f"/api/practice-sessions/{run['id']}").json()
    assert reopened["rule_version"] == version
    assert reopened["items"][index]["verdict"] == "accepted"
    assert reopened["can_continue"] is False
    assert answer(target, run, index, text, submission_id).json() == saved
    current = create_scene(target).json()
    if index:
        assert answer(target, current, 0, "My name is 李").status_code == 200
    assert answer(target, current, index, text).json()["verdict"] == "unknown"


def test_el15_expansion_rollback_only_marks_new_scene_evidence_historical(ec):
    card_id = ec.seed_card(word="thank", meaning="感谢")
    for scene_id, texts in [
        ("drinks", ["Can I have water, please?", "one", "Yes, thank you."]),
        (
            "directions",
            [
                "Excuse me, where is the station?",
                "Should I turn left?",
                "Yes, thank you.",
            ],
        ),
    ]:
        run = create_scene(ec, scene_id).json()
        for index, text in enumerate(texts):
            assert answer(ec, run, index, text).status_code == 200
    ec.settings.scene_expansions_enabled = False
    ec.restart()
    evidence = ec.client.get(f"/api/cards/{card_id}").json()["learning_evidence"][
        "application"
    ]
    contexts = {c["scene_id"]: c for c in evidence["contexts"]}
    assert contexts["drinks"]["status"] == "verified"
    assert contexts["directions"]["status"] == "stale"
    assert evidence["status"] == "verified"
    assert (
        ec.client.get(f"/api/practice-sessions/{run['id']}").json()["creation_enabled"]
        is False
    )


@pytest.mark.parametrize(
    "index,text",
    [
        (1, "I am from I am"),
        (1, "I am from my name"),
        (1, "I am from here"),
        (0, "My name is I'm"),
        (1, "I am from I'm"),
        (1, "I am from You’re"),
        (0, "My name is They've"),
        (1, "I am from can't"),
        (1, "I am from Iʼm"),
        (0, "I am a teacher"),
    ],
)
def test_el15_grammar_fragments_are_not_name_or_place_slots(ec, index, text):
    card_id = ec.seed_card(word="tea", meaning="茶")
    run = create_scene(ec).json()
    texts = ["My name is 李", "I am from 北京", "I like tea."]
    texts[index] = text
    result = None
    for position, value in enumerate(texts):
        response = answer(ec, run, position, value)
        assert response.status_code == 200, response.text
        result = response.json()
        if position == index:
            assert result["verdict"] == "unknown"
    assert result is not None
    assert result["session"]["status"] == "completed"
    assert result["session"]["application_verified"] is False
    assert (
        ec.client.get(f"/api/cards/{card_id}").json()["learning_evidence"][
            "application"
        ]["status"]
        == "insufficient"
    )
