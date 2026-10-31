"""Release acceptance exercises the public report CLI."""

import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

import pytest


def test_spec_coverage_requires_all_cases():
    result = subprocess.run(
        ["node", "e2e/spec-coverage.mjs", "--self-test"],
        check=False,
        text=True,
        capture_output=True,
    )
    assert result.returncode == 0, result.stderr
    assert "missing-case-rejected" in result.stdout
    assert "skipped-case-rejected" in result.stdout


def test_contract_report_requires_each_successful_parameter():
    result = subprocess.run(
        [sys.executable, "e2e/support/contracts.py", "--self-test"],
        check=False,
        text=True,
        capture_output=True,
    )
    assert result.returncode == 0, result.stderr
    assert "missing-parameter-rejected" in result.stdout
    assert "skipped-parameter-rejected" in result.stdout


@pytest.mark.parametrize("status", ["skipped", "failed", "timedOut", "interrupted"])
def test_report_cli_rejects_nonpassing_execution(tmp_path, status):
    report = tmp_path / "playwright.json"
    report.write_text(
        json.dumps(
            {
                "errors": [],
                "suites": [
                    {
                        "specs": [
                            {
                                "title": "EC-01 no-key-home",
                                "tests": [
                                    {
                                        "projectName": "mobile",
                                        "expectedStatus": "passed",
                                        "status": "expected",
                                        "results": [{"status": status}],
                                    }
                                ],
                            }
                        ]
                    }
                ],
            }
        )
    )
    result = subprocess.run(
        ["node", "e2e/spec-coverage.mjs", str(report)],
        check=False,
        text=True,
        capture_output=True,
    )
    assert result.returncode == 1
    assert "Non-passing" in result.stderr


def test_report_cli_rejects_missing_and_blocked(tmp_path):
    report = tmp_path / "playwright.json"
    for payload, diagnostic in [
        ({"errors": [], "suites": []}, "Missing spec coverage"),
        ({"errors": [{"message": "server unavailable"}], "suites": []}, "Blocked"),
    ]:
        report.write_text(json.dumps(payload))
        result = subprocess.run(
            ["node", "e2e/spec-coverage.mjs", str(report)],
            check=False,
            text=True,
            capture_output=True,
        )
        assert result.returncode == 1
        assert diagnostic in result.stderr


@pytest.mark.parametrize(
    "arguments",
    [
        ["--grep", "T01"],
        ["--project", "mobile"],
        ["--ticket"],
        ["--ticket", "EC-01", "--grep", "home"],
    ],
)
def test_release_runner_rejects_filter_arguments(arguments):
    result = subprocess.run(
        ["node", "e2e/run.mjs", *arguments], check=False, text=True, capture_output=True
    )
    assert result.returncode == 2
    assert "unfiltered" in result.stderr


def run_diagnostic(stdout):
    line = next(
        line for line in stdout.splitlines() if line.startswith("Release diagnostics: ")
    )
    return Path(line.removeprefix("Release diagnostics: "))


def test_release_runner_empty_ticket_fails_with_retained_diagnostics():
    result = subprocess.run(
        ["node", "e2e/run.mjs", "--ticket", "EC-99"],
        check=False,
        text=True,
        capture_output=True,
        timeout=30,
    )
    assert result.returncode == 1
    directory = run_diagnostic(result.stdout)
    evidence = json.loads((directory / "run.json").read_text())
    assert evidence["status"] == "failed"
    assert evidence["assets"]
    assert evidence["built_at"]
    assert evidence["source_sha256"]
    assert "No tests found" in result.stdout + result.stderr


def test_release_runner_interrupted_fails_with_retained_diagnostics():
    process = subprocess.Popen(
        ["node", "e2e/run.mjs", "--ticket", "EC-99"],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    try:
        first = process.stdout.readline()
        directory = run_diagnostic(first)
        process.send_signal(signal.SIGTERM)
        remaining, _ = process.communicate(timeout=15)
        assert process.returncode == 1, first + remaining
        evidence = json.loads((directory / "run.json").read_text())
        assert evidence["status"] == "interrupted"
        assert "interrupted" in evidence["detail"]
    finally:
        if process.poll() is None:
            process.kill()
            process.communicate()


@pytest.mark.parametrize(
    "missing_title",
    [
        "EC-16 TTS retries the same word after provider recovery",
        "EC-16 a newer replay owns its playback deadline",
        "EC-16 speech prewarming cannot block detail or saving",
    ],
)
def test_release_gate_requires_tts_regression_branches(tmp_path, missing_title):
    mapping = subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            "import {requirements} from './e2e/spec-coverage.mjs'; console.log(JSON.stringify(requirements))",
        ],
        check=True,
        text=True,
        capture_output=True,
    )
    titles = {
        title for group in json.loads(mapping.stdout).values() for title in group
    } - {missing_title}
    report = tmp_path / "playwright.json"
    report.write_text(
        json.dumps(
            {
                "errors": [],
                "suites": [
                    {
                        "specs": [
                            {
                                "title": title,
                                "tests": [
                                    {
                                        "projectName": project,
                                        "expectedStatus": "passed",
                                        "status": "expected",
                                        "results": [{"status": "passed"}],
                                    }
                                    for project in ["mobile", "desktop"]
                                ],
                            }
                            for title in sorted(titles)
                        ]
                    }
                ],
            }
        )
    )
    result = subprocess.run(
        ["node", "e2e/spec-coverage.mjs", str(report)],
        check=False,
        text=True,
        capture_output=True,
    )
    assert result.returncode == 1
    assert f"T20/mobile: {missing_title}" in result.stderr
    assert f"T20/desktop: {missing_title}" in result.stderr


@pytest.mark.skipif(
    os.name != "posix",
    reason="POSIX signals; Windows termination is not natively verified",
)
@pytest.mark.parametrize("interrupt_signal", [signal.SIGTERM, signal.SIGINT])
def test_contract_wrapper_interrupt_reaps_pytest(tmp_path, interrupt_signal):
    marker = tmp_path / "pytest.pid"
    plugin = tmp_path / "ec16_paused_pytest.py"
    plugin.write_text(
        "import os,time\nfrom pathlib import Path\n"
        f"def pytest_sessionstart(session):\n    Path({str(marker)!r}).write_text(str(os.getpid()))\n"
        "    while True: time.sleep(1)\n"
    )
    report = tmp_path / "installation.xml"
    process = subprocess.Popen(
        [
            sys.executable,
            "e2e/support/contracts.py",
            "--group",
            "installation",
            "--report",
            str(report),
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        env={
            **os.environ,
            "PYTHONPATH": str(tmp_path) + os.pathsep + str(Path.cwd()),
            "PYTEST_ADDOPTS": "-p ec16_paused_pytest",
        },
    )
    child_pid = None
    try:
        deadline = time.monotonic() + 10
        while (
            not marker.exists()
            and process.poll() is None
            and time.monotonic() < deadline
        ):
            time.sleep(0.02)
        assert marker.exists(), "real pytest did not reach startup pause"
        child_pid = int(marker.read_text())
        process.send_signal(interrupt_signal)
        process.wait(timeout=5)
        assert process.returncode != 0
        try:
            os.kill(child_pid, 0)
        except ProcessLookupError:
            pass
        else:
            pytest.fail(
                f"interrupted wrapper left pytest child {child_pid} alive/unreaped"
            )
        diagnostic = report.with_suffix(".log").read_text()
        assert f"INTERRUPTED={signal.Signals(interrupt_signal).name}" in diagnostic
        assert "EXIT_CODE=" in diagnostic
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=5)
        if child_pid is not None:
            try:
                os.kill(child_pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        process.communicate(timeout=5)
