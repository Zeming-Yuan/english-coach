"""EL-21 qualifies actual release reports, never test titles alone."""

import json
import subprocess


def test_el21_release_requires_new_journey():
    result = subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            (
                "import {requirements} from './e2e/spec-coverage.mjs';"
                "console.log(JSON.stringify(requirements['EL-JOURNEY'] || []));"
            ),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    assert json.loads(result.stdout) == [
        "EL-21 new install completes six learning paths",
        "EL-21 upgraded database completes six learning paths",
        "EL-21 V3 device transfer resumes saved learning and contexts",
        "EL-21 restore failures protect learning and allow continuation",
        "EL-21 HTTP restore and content contracts",
        "EL-21 unavailable browser storage resumes the saved course context",
    ]


def test_el21_every_missing_or_failed_journey_is_rejected():
    result = subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            r"""
import {requirements, projects, assertSpecCoverage} from "./e2e/spec-coverage.mjs";
const build = () => ({errors: [], suites: [{specs:
  [...new Set(Object.values(requirements).flat())].map(title => ({title,
    tests: projects.map(projectName => ({projectName, expectedStatus: "passed",
      status: "expected", results: [{status: "passed"}]}))}))}]});
assertSpecCoverage(build());
const rejected = [];
for (const title of requirements["EL-JOURNEY"]) {
  for (const mutation of ["missing", "mobile", "desktop", "skipped", "retry", "interrupted"]) {
    const report = build();
    const row = report.suites[0].specs.find(row => row.title === title);
    if (mutation === "missing") report.suites[0].specs = report.suites[0].specs.filter(s => s.title !== title);
    else if (["mobile", "desktop"].includes(mutation)) row.tests = row.tests.filter(t => t.projectName !== mutation);
    else if (mutation === "retry") row.tests[0].results.unshift({status: "failed"});
    else row.tests[0].results[0].status = mutation;
    try { assertSpecCoverage(report); } catch { rejected.push([title, mutation]); }
  }
}
console.log(JSON.stringify(rejected));
""",
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    rejected = json.loads(result.stdout)
    assert len(rejected) == 36
    assert len({tuple(row) for row in rejected}) == 36


def test_el21_failed_run_identifies_its_workspace():
    from pathlib import Path

    result = subprocess.run(
        ["node", "e2e/run.mjs", "--ticket", "EL-99"],
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 1
    directory = next(
        line.removeprefix("Release diagnostics: ")
        for line in result.stdout.splitlines()
        if line.startswith("Release diagnostics: ")
    )
    evidence = json.loads((Path(directory) / "run.json").read_text())
    assert evidence["workspace"]["root"] == str(Path.cwd().resolve())
    assert evidence["workspace"]["git_common_dir"]
    assert evidence["finished_at"]
    assert evidence["assets"]


def test_el21_device_transfer_discovers_original_lesson_context(ec, ec_factory):
    from uuid import uuid4

    from app.models.lesson import Lesson

    ec.seed_card(word="book", meaning="书")
    with ec.SessionLocal() as db:
        lesson = Lesson(
            level=1,
            title="书",
            content={
                "words": [{"word": "book", "meaning": "书"}],
                "dialogue": [],
                "tips": [],
            },
        )
        db.add(lesson)
        db.commit()
        lesson_id = lesson.id
    created = ec.client.post(
        "/api/practice-sessions",
        json={
            "id": str(uuid4()),
            "purpose": "lesson_check",
            "lesson_id": lesson_id,
        },
    )
    assert created.status_code == 200, created.text
    run = created.json()
    path = f"/api/practice-sessions/{run['id']}/items/{run['items'][0]['id']}"
    assert (
        ec.client.post(path + "/assistance", json={"kind": "first_letter"}).status_code
        == 200
    )
    payload = ec.client.get("/api/export/backup").json()
    target = ec_factory()
    preview = target.client.post("/api/import/preview", json=payload)
    assert preview.status_code == 200, preview.text
    assert (
        target.client.post(
            "/api/import/cards",
            json={
                "backup": payload,
                "expected_revision": preview.json()["expected_revision"],
            },
        ).status_code
        == 200
    )
    mapped = target.client.get("/api/lessons").json()["lessons"][0]["id"]
    before = target.snapshot()
    discovered = target.client.get(
        f"/api/practice-sessions?purpose=lesson_check&lesson_id={mapped}"
    )
    assert discovered.status_code == 200, discovered.text
    assert [row["id"] for row in discovered.json()["sessions"]] == [run["id"]]
    assert (
        target.client.get(
            f"/api/practice-sessions?purpose=lesson_check&lesson_id={mapped + 100}"
        ).json()["sessions"]
        == []
    )
    assert target.snapshot() == before
    saved = target.client.get(f"/api/practice-sessions/{run['id']}").json()
    assert saved["items"][0]["assistance"] == ["first_letter"]
    result = target.client.post(
        path + "/attempts", json={"submission_id": str(uuid4()), "answer": "book"}
    )
    assert result.status_code == 200, result.text
    assert result.json()["session"]["items"][0]["assistance"] == ["first_letter"]


def test_el21_external_background_request_does_not_consume_story_material():
    from tests.support.llm_queue import QueuedLLM

    client = QueuedLLM([{"title": "saved story"}], background_sentence_response={})
    background = client.chat.completions.create(
        messages=[
            {
                "role": "system",
                "content": "你是零基础英语老师。为目标单词生成一个用于阅读练习的句子。\n要求",
            }
        ]
    )
    assert json.loads(background.choices[0].message.content) == {}
    foreground = client.chat.completions.create(
        messages=[{"role": "system", "content": "编写适合初学者的英文故事。"}]
    )
    assert json.loads(foreground.choices[0].message.content) == {"title": "saved story"}


import pytest


@pytest.mark.parametrize(
    "query",
    [
        "purpose=lesson_check",
        "purpose=lesson_check&lesson_id=0",
        "purpose=lesson_check&lesson_id=-1",
        "purpose=lesson_check&lesson_id=1&window=day",
        "purpose=targeted&lesson_id=1",
        "purpose=delayed_check&window=day&lesson_id=1",
    ],
)
def test_el21_context_discovery_rejects_cross_purpose_filters(ec, query):
    before = ec.snapshot()
    assert ec.client.get("/api/practice-sessions?" + query).status_code == 422
    assert ec.snapshot() == before


def test_el21_transfer_comparison_retains_event_and_contact_order():
    result = subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            r"""
import {normalizedBackup} from "./e2e/support/backup-comparison.mjs";
const payload = {cards: [{id: 1, word: "hello", kind: "word"}], lessons: [], stories: [],
  learning_events: [{id: "a", correct: false, occurred_at: "2026-10-01T01:00:00"},
                    {id: "b", correct: true, occurred_at: "2026-10-01T01:00:00"}],
  extensions: {learning_contacts: [{id: 1, submission_id: "a", source: "card_detail"},
                                  {id: 2, submission_id: "b", source: "words_list"}]}};
const original = JSON.stringify(normalizedBackup(payload));
const eventReversal = structuredClone(payload);
eventReversal.learning_events.reverse();
const contactReversal = structuredClone(payload);
contactReversal.extensions.learning_contacts.reverse();
console.log(JSON.stringify([
  original !== JSON.stringify(normalizedBackup(eventReversal)),
  original !== JSON.stringify(normalizedBackup(contactReversal))
]));
""",
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    assert json.loads(result.stdout) == [True, True]


def test_el21_delivered_scene_revision_blocks_destructive_rollback(ec):
    """Exercise the historical barrier, not just the newer EL-18 refusal."""
    from uuid import uuid4

    from alembic.config import Config
    from sqlalchemy import text

    from alembic import command

    run = ec.client.post(
        "/api/practice-sessions",
        json={
            "id": str(uuid4()),
            "purpose": "scene",
            "scene_id": "drinks",
        },
    ).json()
    saved = ec.client.post(
        f"/api/practice-sessions/{run['id']}/items/{run['items'][0]['id']}/attempts",
        json={"submission_id": str(uuid4()), "answer": "Can I have water, please?"},
    )
    assert saved.status_code == 200, saved.text
    tables = ("practice_sessions", "practice_items", "scene_attempts")
    # Project genuine saved history into the delivered old schema, in an
    # isolated fixture. This is preparation, never a production downgrade.
    ec.rebuild_legacy_database("el14_scene_attempts", preserve_tables=tables)

    def migration_rows():
        with ec.engine.connect() as connection:
            return {
                table: [
                    dict(row._mapping)
                    for row in connection.execute(
                        text(f"SELECT * FROM {table} ORDER BY id")
                    )
                ]
                for table in tables
            }

    before = migration_rows()
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", ec.database_url)
    with pytest.raises(RuntimeError, match="保留场景记录"):
        command.downgrade(config, "el13_merge_story_heads")
    after = migration_rows()
    with ec.engine.connect() as connection:
        assert (
            connection.scalar(text("SELECT version_num FROM alembic_version"))
            == "el14_scene_attempts"
        )
    assert after == before
    assert len(after["scene_attempts"]) == 1
