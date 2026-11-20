"""The local demo is readable with no AI and leaves the account unchanged."""


def test_demo_is_read_only_and_available_without_ai(ec):
    assert not ec.client.get("/api/ai-config").json()["has_key"]
    before = ec.client.get("/api/export/backup").json()

    response = ec.client.get("/api/lessons/demo")
    assert response.status_code == 200, response.text
    demo = response.json()
    assert demo["mode"] == "demo"
    assert demo["version"] == "demo-lesson-v1"
    assert demo["title"] == "问候示范课"
    assert demo["dialogue"][0]["en"] == "Hello!"
    assert demo["task"]["expected"] in demo["task"]["options"]
    assert ec.client.get("/api/lessons/demo").json() == demo

    after = ec.client.get("/api/export/backup").json()
    for field in ("lessons", "cards", "learning_events", "extensions"):
        assert after[field] == before[field]
