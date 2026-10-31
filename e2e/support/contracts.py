"""Execute named public HTTP/process supplements; qualify actual JUnit cases."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


def cases(module, name, parameters=None):
    prefix = f"tests/{module}.py::{name}"
    return [prefix] if parameters is None else [f"{prefix}[{p}]" for p in parameters]


GROUPS = {
    "installation": (
        cases("test_installation", "test_fresh_migration_contains_rating")
        + cases(
            "test_installation",
            "test_legacy_configuration_explains_migration",
            ["env_update0-LLM_API_KEY", r"env_update1-\u51b2\u7a81"],
        )
        + cases("test_installation", "test_custom_database_target")
        + cases("test_installation", "test_explicit_migration_url_wins_over_settings")
    ),
    "upgrade": cases("test_installation", "test_stamped_missing_rating_repairs")
    + cases("test_installation", "test_upgraded_database_accepts_a_review"),
    "concurrent": cases(
        "test_legacy_api_compatibility",
        "test_concurrent_submission_serializes_public_state",
        ["False", "True"],
    ),
    "invalid": (
        cases(
            "test_full_restore",
            "test_invalid_full_graph_rejected_before_any_write",
            [
                "future",
                "duplicate",
                "dangling",
                "nan",
                "negative",
                "bad_id",
                "bad_date",
                "unknown",
                "missing",
                "timezone",
                "event_command",
                "event_cache",
                "event_uuid",
                "event_day",
                "nested_nan",
                "duplicate_submission",
            ],
        )
        + cases(
            "test_legacy_restore",
            "test_legacy_invalid_review_focus",
            ["review0", "review1", "review2", "review3"],
        )
        + cases("test_legacy_restore", "test_legacy_nan_stability_is_rejected")
        + cases(
            "test_full_restore",
            "test_full_snapshot_rejects_corrupt_replay_contract",
            [
                "coerced_count",
                "bad_summary",
                "bad_fingerprint",
                "unknown_command",
                "bad_event_kind",
                "missing_command",
                "bad_question",
                "bad_exported_date",
                "bad_baseline_kind",
            ],
        )
        + cases(
            "test_full_restore",
            "test_full_snapshot_rejects_invalid_audit_fields",
            [
                "command_expected",
                "cached_due",
                "baseline_fingerprint",
                "source_review_id",
                "numeric_export_time",
                "numeric_version",
            ],
        )
    ),
    "faults": cases(
        "test_full_restore",
        "test_full_restore_faults_preserve_entire_target_and_safety_copy",
        ["safety_disk", "insert", "commit"],
    ),
    "ambiguous": cases("test_legacy_restore", "test_ambiguous_target_is_rejected"),
}


def qualify(xml, expected):
    root = ET.fromstring(xml)
    found = []
    for case in root.iter("testcase"):
        identity = case.get("classname", "") + "." + case.get("name", "")
        if any(case.find(tag) is not None for tag in ("skipped", "failure", "error")):
            raise ValueError(f"Non-passing contract case: {identity}")
        found.append(identity)
    if len(found) != len(set(found)) or set(found) != set(expected):
        raise ValueError(
            f"Missing/unexpected contract cases: expected={expected}, actual={found}"
        )
    return found


def self_test():
    qualify(
        '<testsuite><testcase classname="public" name="branch"/></testsuite>',
        ["public.branch"],
    )
    for name, xml in [
        ("missing-parameter", "<testsuite/>"),
        (
            "skipped-parameter",
            '<testsuite><testcase classname="public" name="branch"><skipped/></testcase></testsuite>',
        ),
        (
            "failed-parameter",
            '<testsuite><testcase classname="public" name="branch"><failure/></testcase></testsuite>',
        ),
        (
            "blocked-parameter",
            '<testsuite><testcase classname="public" name="branch"><error/></testcase></testsuite>',
        ),
    ]:
        try:
            qualify(xml, ["public.branch"])
        except ValueError:
            print(name + "-rejected")
        else:
            raise AssertionError(name + " incorrectly accepted")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--group", choices=GROUPS)
    parser.add_argument("--report")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    if not args.group or not args.report:
        parser.error("--group and --report required")
    selectors = GROUPS[args.group]
    report = Path(args.report)
    report.parent.mkdir(parents=True, exist_ok=True)
    command = [sys.executable, "-m", "pytest", "-q", *selectors, f"--junitxml={report}"]
    result = subprocess.run(
        command,
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    report.with_suffix(".log").write_text(
        repr(command) + "\n" + result.stdout + f"\nEXIT_CODE={result.returncode}\n"
    )
    print(result.stdout)
    if result.returncode:
        raise SystemExit(result.returncode)
    expected = []
    for selector in selectors:
        module, name = selector.split("::")
        expected.append(module.removesuffix(".py").replace("/", ".") + "." + name)
    actual = qualify(report.read_text(), expected)
    print(json.dumps({"group": args.group, "passed_cases": actual}))


if __name__ == "__main__":
    main()
