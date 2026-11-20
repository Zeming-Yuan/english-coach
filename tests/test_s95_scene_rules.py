"""S95-11: versioned drink orders through the public practice API."""

from tests.test_el14_three_turn_drink_scene import answer, create_scene


def test_natural_water_request_is_accepted_in_new_round(ec):
    run = create_scene(ec).json()
    saved = answer(ec, run, 0, "A glass of water, please.")
    assert saved.status_code == 200, saved.text
    assert saved.json()["verdict"] == "accepted"
    assert saved.json()["session"]["rule_version"] == "drinks-v2"


def test_existing_v1_round_keeps_its_frozen_verdict(ec, monkeypatch):
    from app.services.scenes import SCENE_RULE_FILES

    with monkeypatch.context() as patch:
        patch.setitem(SCENE_RULE_FILES, "drinks", {"drinks-v1": "drinks-v1.json"})
        old = create_scene(ec).json()

    saved = answer(ec, old, 0, "A glass of water, please.")
    assert saved.status_code == 200, saved.text
    assert saved.json()["verdict"] == "unknown"
    assert saved.json()["session"]["rule_version"] == "drinks-v1"


def test_unrecognized_request_and_retry_do_not_create_application_evidence(ec):
    card_id = ec.seed_card(word="water", meaning="水")
    for text in ("A glass of coffee, please.", "Two glasses of water, please."):
        run = create_scene(ec).json()
        first = answer(ec, run, 0, text).json()
        assert first["verdict"] == "unknown"
        retry = answer(ec, run, 0, "A glass of water, please.").json()
        assert retry["verdict"] == "accepted"
        assert retry["first_response"] is False
        assert retry["session"]["items"][0]["verdict"] == "unknown"
        assert answer(ec, run, 1, "One cup, please.").status_code == 200
        completed = answer(ec, run, 2, "Yes, thank you.").json()
        assert completed["session"]["status"] == "completed"
    card = ec.client.get(f"/api/cards/{card_id}").json()
    assert card["learning_evidence"]["application"]["status"] == "insufficient"
