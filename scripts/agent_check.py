"""Fetch and verify the integration base; optionally lint changed Python files."""

import argparse
import subprocess
import sys
from pathlib import Path


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], text=True).strip()


def check(base: str, remote: str, lint: bool) -> None:
    root = Path(git("rev-parse", "--show-toplevel"))
    # Use repository-relative paths even when invoked from a subdirectory.
    ref = f"refs/remotes/{remote}/{base}"
    subprocess.run(["git", "check-ref-format", ref], check=True, cwd=root)
    subprocess.run(
        ["git", "fetch", "--no-tags", "--", remote, f"refs/heads/{base}:{ref}"],
        check=True,
        cwd=root,
    )
    base_sha = git("rev-parse", "--verify", ref)
    head = git("rev-parse", "HEAD")
    if subprocess.run(
        ["git", "merge-base", "--is-ancestor", base_sha, head],
        cwd=root,
        check=False,
    ).returncode:
        raise ValueError(
            f"HEAD {head} does not contain {remote}/{base} {base_sha}. "
            "Integrate the latest base in the task branch, then revalidate."
        )
    if subprocess.check_output(["git", "ls-files", "--unmerged"], cwd=root):
        raise ValueError("Resolve the pending merge before verification.")
    print(f"Verified base {remote}/{base}={base_sha}; HEAD={head}", flush=True)
    if not lint:
        return
    files = set()
    for args in (
        ("diff", "--name-only", "--diff-filter=ACMR", "-z", f"{base_sha}...HEAD"),
        ("diff", "--name-only", "--diff-filter=ACMR", "-z", "HEAD"),
        ("ls-files", "--others", "--exclude-standard", "-z"),
    ):
        # -z preserves spaces and newlines in paths; paths are never shell commands.
        output = subprocess.check_output(["git", *args], cwd=root, text=True)
        files.update(
            name
            for name in output.split("\0")
            if name.endswith(".py") and (root / name).is_file()
        )
    if files:
        for args in (("check",), ("format", "--check")):
            subprocess.run(
                [sys.executable, "-m", "ruff", *args, "--", *sorted(files)],
                check=True,
                cwd=root,
            )
    subprocess.run(
        ["git", "diff", "--check", f"{base_sha}...HEAD"], check=True, cwd=root
    )
    subprocess.run(["git", "diff", "--check", "HEAD"], check=True, cwd=root)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--base", default="dev", help="integration branch (default: dev)"
    )
    parser.add_argument("--remote", default="origin")
    parser.add_argument(
        "--lint", action="store_true", help="Ruff check/format changed Python"
    )
    args = parser.parse_args()
    try:
        check(args.base, args.remote, args.lint)
    except (ValueError, OSError, subprocess.CalledProcessError) as exc:
        print(f"Agent check failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
