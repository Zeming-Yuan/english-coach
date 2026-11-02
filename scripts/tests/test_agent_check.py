"""Exercise the agent guard against disposable local Git remotes."""

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "agent_check.py"


class AgentCheckTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.env = {
            **os.environ,
            "GIT_AUTHOR_NAME": "Fixture",
            "GIT_AUTHOR_EMAIL": "fixture@example.invalid",
            "GIT_COMMITTER_NAME": "Fixture",
            "GIT_COMMITTER_EMAIL": "fixture@example.invalid",
        }
        self.remote = self.root / "remote.git"
        self.repo = self.root / "work"
        self.git(self.root, "init", "--bare", str(self.remote))
        self.git(self.root, "clone", str(self.remote), str(self.repo))
        self.git(self.repo, "switch", "-c", "dev")
        (self.repo / "README.md").write_text("base\n")
        (self.repo / "tracked.py").write_text('"""Base fixture."""\n')
        self.git(self.repo, "add", "README.md", "tracked.py")
        self.git(self.repo, "commit", "-m", "base")
        self.git(self.repo, "push", "origin", "dev")
        self.git(self.repo, "switch", "-c", "codex/fixture")

    def git(self, cwd, *args):
        return subprocess.run(
            ["git", *args],
            cwd=cwd,
            env=self.env,
            check=True,
            text=True,
            capture_output=True,
        ).stdout.strip()

    def check(self, *args):
        return subprocess.run(
            [sys.executable, str(SCRIPT), *args],
            cwd=self.repo,
            check=False,
            env=self.env,
            text=True,
            capture_output=True,
        )

    def advance_remote(self):
        other = self.root / "other"
        self.git(self.root, "clone", "--branch", "dev", str(self.remote), str(other))
        (other / "later.md").write_text("next ticket\n")
        self.git(other, "add", "later.md")
        self.git(other, "commit", "-m", "next ticket")
        self.git(other, "push", "origin", "dev")

    def test_fresh_branch_passes(self):
        result = self.check()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(self.git(self.repo, "rev-parse", "HEAD"), result.stdout)

    def test_fetch_detects_stale_base_and_preserves_dirty_work(self):
        self.advance_remote()
        (self.repo / "README.md").write_text("local work\n")
        before = self.git(self.repo, "rev-parse", "HEAD")
        result = self.check()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("does not contain", result.stderr)
        self.assertEqual(self.git(self.repo, "rev-parse", "HEAD"), before)
        self.assertEqual((self.repo / "README.md").read_text(), "local work\n")

    def test_integrating_latest_base_passes(self):
        self.advance_remote()
        self.git(self.repo, "fetch", "origin")
        self.git(self.repo, "merge", "origin/dev")
        self.assertEqual(self.check().returncode, 0)

    def test_fetch_failure_never_reports_freshness(self):
        self.git(
            self.repo, "remote", "set-url", "origin", str(self.root / "missing.git")
        )
        self.assertNotEqual(self.check().returncode, 0)

    def test_lint_checks_new_untracked_python(self):
        (self.repo / "invalid.py").write_text("def broken(:\n")
        result = self.check("--lint")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("invalid.py", result.stdout + result.stderr)

    def test_lint_checks_committed_python(self):
        (self.repo / "invalid.py").write_text("def broken(:\n")
        self.git(self.repo, "add", "invalid.py")
        self.git(self.repo, "commit", "-m", "invalid source")
        result = self.check("--lint")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("invalid.py", result.stdout + result.stderr)

    def test_lint_checks_modified_tracked_python(self):
        (self.repo / "tracked.py").write_text("def broken(:\n")
        result = self.check("--lint")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("tracked.py", result.stdout + result.stderr)

    def test_lint_rejects_unformatted_python(self):
        (self.repo / "unformatted.py").write_text("value=1\n")
        result = self.check("--lint")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.repo / "unformatted.py").read_text(), "value=1\n")

    def test_unknown_base_fails(self):
        self.assertNotEqual(self.check("--base", "missing").returncode, 0)

    def test_lint_passes_formatted_python(self):
        (self.repo / "valid.py").write_text('"""Fixture."""\n')
        result = self.check("--lint")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
