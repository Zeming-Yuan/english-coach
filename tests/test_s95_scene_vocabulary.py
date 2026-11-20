"""S95-10: explicit, read-only vocabulary preparation for scene tasks."""


def test_preparation_vocabulary_is_read_only(ec):
    before = ec.snapshot()
    response = ec.client.get("/api/scenes/drinks/vocabulary")
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["scene_id"] == "drinks"
    assert result["title"] == "买饮品"
    assert [(row["word"], row["meaning"]) for row in result["words"]] == [
        ("water", "水"),
        ("one", "一"),
        ("thank", "感谢"),
    ]
    assert all(row["card_id"] is None for row in result["words"])
    assert all(row["content_revision"] is None for row in result["words"])
    assert ec.snapshot() == before


def test_preparation_prefers_current_word_card_and_revision(ec):
    card_id = ec.seed_card(word="WaTeR", meaning="旧释义", example="An old example.")
    update = ec.client.put(
        f"/api/cards/{card_id}",
        json={"meaning": "自定义水义", "example": "We need more water."},
    )
    assert update.status_code == 200, update.text
    card = ec.client.get(f"/api/cards/{card_id}").json()

    result = ec.client.get("/api/scenes/drinks/vocabulary").json()
    assert result["words"][0] == {
        "word": "water",
        "meaning": "自定义水义",
        "example": "We need more water.",
        "card_id": card_id,
        "content_revision": card["content_revision"],
    }
    assert card["content_revision"]["version"] == 2
    assert result["words"][1]["card_id"] is None


def test_preparation_ignores_same_form_sentence_card(ec):
    ec.seed_card(word="water", kind="sentence", meaning="句子卡")
    before = ec.snapshot()
    result = ec.client.get("/api/scenes/drinks/vocabulary").json()
    assert result["words"][0] == {
        "word": "water",
        "meaning": "水",
        "example": "Water is cold.",
        "card_id": None,
        "content_revision": None,
    }
    assert ec.snapshot() == before


def test_preparation_vocabulary_is_scoped_to_each_scene(ec):
    ec.seed_card(word="water", meaning="场景外的释义")
    for scene_id, words in (
        ("introduction", ["tea"]),
        ("directions", ["station", "left", "thank"]),
    ):
        response = ec.client.get(f"/api/scenes/{scene_id}/vocabulary")
        assert response.status_code == 200, response.text
        assert [row["word"] for row in response.json()["words"]] == words
    assert ec.client.get("/api/scenes/unknown/vocabulary").status_code == 404


def test_word_card_link_and_catalog_agree_on_which_word_is_missing(ec):
    card_id = ec.seed_card(word="WaTeR", meaning="水")
    scenes = ec.client.get("/api/scenes").json()["scenes"]
    drinks = next(scene for scene in scenes if scene["id"] == "drinks")
    assert drinks["preparation"]["missing_words"] == ["one", "thank"]
    prepared = ec.client.get("/api/scenes/drinks/vocabulary").json()
    assert prepared["words"][0]["card_id"] == card_id


def test_preparation_cannot_pair_old_text_with_a_concurrent_edit_revision(ec):
    from sqlalchemy import event
    from sqlalchemy.orm import ORMExecuteState, Session
    from sqlalchemy.sql import Select

    from app.models.card import Card

    card_id = ec.seed_card(word="water", meaning="旧释义")
    original = ec.client.get(f"/api/cards/{card_id}").json()
    edited = False

    def edit_after_card_read(state: ORMExecuteState):
        nonlocal edited
        statement = state.statement
        if (
            edited
            or state.session.bind is not ec.engine
            or not isinstance(statement, Select)
            or statement.column_descriptions[0]["entity"] is not Card
        ):
            return None
        edited = True
        result = state.invoke_statement().freeze()
        updated = ec.client.put(f"/api/cards/{card_id}", json={"meaning": "新释义"})
        assert updated.status_code == 200, updated.text
        return result()

    event.listen(Session, "do_orm_execute", edit_after_card_read)
    try:
        response = ec.client.get("/api/scenes/drinks/vocabulary")
    finally:
        event.remove(Session, "do_orm_execute", edit_after_card_read)
    assert edited
    assert response.status_code == 200, response.text
    entry = response.json()["words"][0]
    assert entry["meaning"] == "旧释义"
    assert entry["content_revision"] == original["content_revision"]
    current = ec.client.get(f"/api/cards/{card_id}").json()
    assert current["meaning"] == "新释义"
    assert current["content_revision"]["version"] == 2
