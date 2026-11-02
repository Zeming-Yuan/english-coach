"""Versioned teaching support; allowed word forms are not personal mastery."""

import json
from pathlib import Path

SUPPORT = json.loads(
    (Path(__file__).parents[1] / "data/support_words.json").read_text()
)
STARTER = {
    "title": "My small book",
    "title_cn": "我的小书",
    "sentences": [
        {"en": "A small book is on my table.", "cn": "我的桌上有一本小书。"},
        {"en": "I sit by the table and open it.", "cn": "我坐在桌旁，把它打开。"},
        {"en": "I read and smile.", "cn": "我读着，笑了。"},
        {"en": "My cup is near the book.", "cn": "我的杯子在书旁。"},
        {"en": "I take the cup and put it by me.", "cn": "我拿起杯子，把它放在身旁。"},
        {"en": "Now I can read my book.", "cn": "现在我可以读我的书了。"},
    ],
    "targets": [],
    "check": {
        "question": "What is on my table?",
        "question_cn": "我的桌上有什么？",
        "options": ["book", "water", "cup"],
        "options_cn": ["书", "水", "杯子"],
        "expected": "book",
        "evidence_index": 0,
    },
}


def starter_payload(*, known_basis="insufficient"):
    return {
        "id": None,
        "mode": "starter",
        "title": STARTER["title"],
        "title_cn": STARTER["title_cn"],
        "content": "\n".join(row["en"] for row in STARTER["sentences"]),
        "content_cn": "\n".join(row["cn"] for row in STARTER["sentences"]),
        "words": [],
        "visible_card_ids": [],
        "line_card_ids": [],
        "version_id": "el11-starter-v1",
        "quality": {
            "known_basis": known_basis,
            "support_version": SUPPORT["version"],
            "unknown_forms": [],
            "known_targets": [],
            "new_targets": [],
        },
        "check_material": None,
    }


import re


def tokens(text: str) -> list[str]:
    return re.findall(r"[a-z]+(?:'[a-z]+)?", text.lower())


def story_profile(mode: str) -> dict:
    if mode != "normal":
        raise ValueError("unsupported story mode")
    return {"min_words": 40, "max_words": 70, "max_sentence": 12, "max_unknown": 2}


def validate_story(
    data: dict, known: set[str], support: set[str], mode: str
) -> list[str]:
    profile = story_profile(mode)
    if not isinstance(data, dict):
        return ["structure"]
    rows = data.get("sentences")
    check = data.get("check")
    if (
        not isinstance(rows, list)
        or not rows
        or any(not isinstance(r, dict) for r in rows)
        or not isinstance(check, dict)
        or any(not isinstance(data.get(k), str) for k in ("title", "title_cn"))
        or not isinstance(data.get("targets"), list)
        or any(not isinstance(t, str) for t in data["targets"])
        or any(not isinstance(r.get(k), str) for r in rows for k in ("en", "cn"))
        or any(
            not isinstance(check.get(k), str)
            for k in ("question", "question_cn", "expected")
        )
        or any(
            not isinstance(check.get(k), list)
            or any(not isinstance(v, str) for v in check[k])
            for k in ("options", "options_cn")
        )
    ):
        return ["structure"]
    errors = []
    body = [t for r in rows for t in tokens(r["en"])]
    texts = [
        data["title"],
        *[r["en"] for r in rows],
        check["question"],
        *check["options"],
    ]
    if not profile["min_words"] <= len(body) <= profile["max_words"]:
        errors.append("length")
    if any(
        len(tokens(sentence)) > profile["max_sentence"]
        for text in texts
        for sentence in re.split(r"[.!?]+", text)
    ):
        errors.append("sentence")
    translations = [
        data["title_cn"],
        *[r["cn"] for r in rows],
        check["question_cn"],
        *check["options_cn"],
    ]
    if (
        any(not r["en"].strip() for r in rows)
        or any(not re.search(r"[\u3400-\u9fff]", text) for text in translations)
        or not tokens(data["title"])
        or not tokens(check["question"])
    ):
        errors.append("translation")
    targets = data["targets"]
    if (
        not targets
        or len(targets) > 4
        or len(set(targets)) != len(targets)
        or any(t != t.lower() or tokens(t) != [t] or t not in body for t in targets)
    ):
        errors.append("target")
    if (
        len({t for text in texts for t in tokens(text)} - known - support)
        > profile["max_unknown"]
    ):
        errors.append("unknown")
    index = check.get("evidence_index")
    options = check["options"]
    expected = check["expected"]
    if (
        len(options) != 3
        or len(check["options_cn"]) != 3
        or any(not tokens(o) for o in options)
        or len({o.strip().lower() for o in options}) != 3
        or expected not in options
        or type(index) is not int
        or not 0 <= index < len(rows)
    ):
        errors.append("question")
    else:
        evidence = tokens(rows[index]["en"])
        if (
            tokens(expected) != [expected.lower()]
            or expected.lower() not in evidence
            or sum(all(t in evidence for t in tokens(o)) for o in options) != 1
        ):
            errors.append("question")
    return errors
