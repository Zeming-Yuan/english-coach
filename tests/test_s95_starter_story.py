"""Bundled story text has a local gloss for every tappable word."""

import re


def test_starter_glosses_cover_the_reader_words(ec):
    response = ec.client.get("/api/stories/starter")
    assert response.status_code == 200
    story = response.json()
    clickable_words = set(re.findall(r"[a-z]{2,}", story["content"].lower()))
    assert set(story["glossary"]) == clickable_words
    assert story["glossary"]["book"] == "书"
    assert story["words"] == []
    assert story["check_material"] is None
