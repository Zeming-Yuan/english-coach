"""EC-01 隔离环境（ECEnv）与逐票 E2E 入口的自检。"""

import subprocess
from pathlib import Path

import pytest
from sqlalchemy import inspect

from app.models.card import Card
from tests.support.ec_env import ECEnv

ROOT = Path(__file__).resolve().parents[1]


def test_ec_env_uses_real_migrations(ec):
    columns = {c["name"] for c in inspect(ec.engine).get_columns("reviews")}
    assert "rating" in columns
    assert ec.client.get("/api/health").status_code == 200


def test_ec_env_home_and_seed_card(ec):
    card_id = ec.seed_card()
    assert card_id > 0
    cards = ec.client.get("/api/cards").json()["cards"]
    assert [card["word"] for card in cards] == ["apple"]

    response = ec.client.get("/")
    assert response.status_code == 200
    assert "EnglishCoach" in response.text


def test_ec_env_without_llm_key_serves_local_api(ec):
    response = ec.client.post("/api/cards/generate", json={"words": ["apple"]})
    assert response.status_code == 503
    assert "LLM_API_KEY" in response.json()["detail"]
    assert ec.client.get("/api/today").status_code == 200


def test_ec_env_clock_can_be_set(ec):
    ec.set_time("2026-11-01T00:30:00Z")
    assert ec.clock.now().isoformat() == "2026-11-01T00:30:00+00:00"


def test_ec_env_injects_one_commit_failure(ec):
    ec.seed_card("banana")
    ec.fail_commit_once()
    db = ec.SessionLocal()
    try:
        db.add(Card(word="cherry", kind="word"))
        with pytest.raises(OSError):
            db.commit()
    finally:
        db.rollback()
        db.close()

    # 故障只生效一次，下一次提交正常
    db = ec.SessionLocal()
    try:
        db.add(Card(word="date", kind="word"))
        db.commit()
    finally:
        db.close()
    words = {card["word"] for card in ec.client.get("/api/cards").json()["cards"]}
    assert {"banana", "date"} <= words


def test_ec_env_restart_keeps_data(ec):
    ec.seed_card("apple")
    ec.restart()
    words = {card["word"] for card in ec.client.get("/api/cards").json()["cards"]}
    assert words == {"apple"}
    assert ec.client.get("/api/health").status_code == 200


def test_ec_factory_gives_independent_databases(ec, ec_factory):
    ec.seed_card("apple")
    other = ec_factory()
    other.seed_card("banana")
    assert {c["word"] for c in ec.client.get("/api/cards").json()["cards"]} == {"apple"}
    assert {c["word"] for c in other.client.get("/api/cards").json()["cards"]} == {
        "banana"
    }


def test_static_assets_work_when_started_from_other_cwd(tmp_path, monkeypatch):
    """从不同工作目录启动/请求，静态目录仍然有效（RF3）。"""
    monkeypatch.chdir(tmp_path)
    env = ECEnv(root=tmp_path / "cwd-env")
    try:
        assert env.client.get("/").status_code == 200
        assert env.client.get("/static/style.css").status_code == 200
    finally:
        env.close()


def _run_e2e_runner(*args: str) -> subprocess.CompletedProcess:
    script = ROOT / "e2e" / "run.mjs"
    assert script.exists(), "E2E 入口 e2e/run.mjs 必须存在"
    return subprocess.run(
        ["node", str(script), *args],
        cwd=ROOT,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        check=False,
    )


def test_e2e_runner_rejects_invalid_ticket():
    result = _run_e2e_runner("--ticket", "EC-1")
    assert result.returncode != 0
    assert "Invalid" in result.stderr + result.stdout


def test_e2e_runner_missing_ticket_value_fails():
    result = _run_e2e_runner("--ticket")
    assert result.returncode != 0


def test_e2e_runner_unknown_ticket_has_no_matches():
    result = _run_e2e_runner("--ticket", "EC-99")
    assert result.returncode != 0
