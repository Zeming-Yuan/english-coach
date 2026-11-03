"""Agent-authored content replay through real generation/publication boundaries.

This is not a live provider test or a measurement of teaching effectiveness.
"""

import json
from pathlib import Path
from uuid import uuid4

import pytest

from tests.support.llm_queue import QueuedLLM

SAMPLES = json.loads(
    (Path(__file__).parents[1] / "e2e/fixtures/el21-content-samples.json").read_text()
)["samples"]


@pytest.mark.parametrize("sample", SAMPLES, ids=[row["id"] for row in SAMPLES])
def test_el21_reviewed_content_publishes_in_its_preparation_state(ec, sample):
    known = [] if sample["state"] == "insufficient" else ["hello"]
    if sample["state"] == "sufficient":
        known += [
            "book",
            "water",
            "cup",
            "table",
            "read",
            "open",
            "small",
            "home",
            "day",
            "sit",
            "smile",
        ]
    ids = [ec.seed_card(word=word, meaning="核对词") for word in known]
    for now in ["2026-10-01T01:00:00Z", "2026-10-02T02:00:00Z"]:
        ec.set_time(now)
        for card_id, word in zip(ids, known):
            result = ec.client.post(
                "/api/typing/check",
                json={
                    "card_id": card_id,
                    "user_input": word,
                    "source": "spelling",
                    "submission_id": str(uuid4()),
                },
            )
            assert result.status_code == 200, result.text
    ec.app.state.llm_client = QueuedLLM([sample["lesson"], sample["story"]])
    course = ec.client.post("/api/lessons/next", json={"operation_id": str(uuid4())})
    assert course.status_code == 200, course.text
    assert course.json()["content"]["dialogue"] == sample["lesson"]["dialogue"]
    before = ec.client.get("/api/export/backup").json()
    story = ec.client.post("/api/stories/generate", json={"operation_id": str(uuid4())})
    assert story.status_code == 200, story.text
    if not known:
        assert story.json()["mode"] == "starter"
        assert story.json()["check_material"] is None
    else:
        assert story.json()["check_material"]["expected"] == "book"
        assert story.json()["quality"]["known_targets"] == sample["story"]["targets"]
    after = ec.client.get("/api/export/backup").json()
    assert after["learning_events"] == before["learning_events"]
    assert ec.client.post("/api/import/preview", json=after).status_code == 200
