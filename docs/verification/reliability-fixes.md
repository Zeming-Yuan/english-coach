# Reliability fixes — 2026-11-05

Source: user-supplied audit and implementation instructions in this chat. Baseline:
Initial local HEAD: `243f0c3358c220d9f9cf5169af1796cd4981782b`.
Fetched implementation/review baseline: `685fb3f16840a553f10f42e22f42e7d87b08fda9`
(`origin/dev`, includes PR #87). Re-check reported defects against this version;
already fixed behaviors are historical evidence, not new changes in this diff.
Original checkout has unrelated README/docs edits; preserved there, excluded here.
No remote tracker writes, pushes, PRs, remote merges or deployments authorized by this task.

Confirmed test seams: HTTP APIs, service public functions, frontend exported lib
functions, observable hook state and page behavior. One failing behavior test,
minimal fix, same test green, then next behavior. Only affected checks; no full suite.

## Task graph and acceptance

Independent implementation slices start at the pinned baseline in separate worktrees.
Integrate the independently verified slices serially; review the integrated fixed diff
along Standards and Spec axes.

- R (routers, user #7–11): bound history days; reject malformed story sentences;
  invalidate check session after revision; atomic difficult-word toggle; case-insensitive
  lookup with consistent card_id; restrict AI test outbound access and sanitize errors.
  Adjacent low-impact router issues: export null timestamp, memos missing-card status,
  TTS cache/error behavior, listening queue starvation, scenes invalid slots.
- S (services, user #12–24): retain existing translation on null; atomic fresh revision
  increments; case-insensitive lesson reuse and phonetic validation; starter batch dedup
  and reserved kind; weighted error timestamp; preserve unscheduled next_due null;
  empty scene replies validation; invalid signature/deep JSON rejected; preserve original
  transaction errors; deterministic event order; weak_only replay identity and frozen
  targets; card batch dedup/chunk cleanup; whole-word cloze.
  Adjacent low-impact services: lesson status, scene assert, scheduler state, estimate validation.
- F (frontend, user #1–6 and views): revision-aware contact pending, normalized pending IDs
  and cleared denied scopes; duration rejection handled; atomic preparation and committed
  pending cleanup; corrupt duration isolation/cancellation; practice validation, errors,
  retry exclusion and resume statistics; readable network errors/empty success; visible
  loading failures, immutable story props, feedback before summary, explicit empty queues,
  snapshot mixed statistics, JSX escaping. Adjacent low-impact hooks/libs: starter exclusion,
  UUID fallback, visibility capability/ref timing, assistance cleanup, lookup failures,
  audio normalization, outcome validation and secure-context TTS.

R/S/F acceptance: reproduce each confirmed defect at its public seam before fixing,
retain compatibility and learning evidence, record affected tests and any unresolved items.
Backend shared files belong to S; R changes routers and its tests only unless coordinated.

## Evidence

Initial guard: `.venv/bin/python scripts/agent_check.py --base dev`.
Further red/green and final scoped results are recorded below as implementation proceeds.

## Integrated delivery and verification

Integration source head: `5ff11ced710e26cf17eff0deaf388d4b92738735`.
Commits: `ae38cb2` scope, `a217848` frontend, `3c256a6` routers, `aacd942`
services/migration, `5ff11ce` review fixes. Detailed per-slice red/green evidence:
[frontend](reliability-frontend.md), [routers](reliability-routers.md),
[services](reliability-services.md). Original checkout changes remain untouched.

Executed on the integrated backend `aacd942` (unchanged by `5ff11ce`):

- `.venv/bin/python -m pytest tests/test_reliability_routers.py tests/test_reliability_services.py -q`
  — **54 passed**, exit 0. Includes the R/S same-timestamp write-order HTTP test,
  revision interleaving, concurrent toggles, migration from previous head and V3
  replay metadata/older-backup compatibility. Isolated pytest SQLite databases;
  no external provider calls. This turns the earlier R-only cross-slice red green.
- `.venv/bin/python scripts/agent_check.py --base dev --lint`
  — exit 0, **32 Python files** Ruff/format clean; fresh origin/dev remains
  `685fb3f16840a553f10f42e22f42e7d87b08fda9`.
- Scoped Pyright over every `.py` from
  `git diff --name-only 685fb3f...aacd942` with `--pythonpath .venv/bin/python`
  — **21 errors**, exit 1. Same 8 R and 13 S baseline diagnostics independently
  reproduced by the slices (details linked above); no newly introduced diagnostic.
  Full output `/tmp/ec-reliability-pyright.txt`. This is a known type-check gap,
  not a passing check. No full-project type invocation was run.

Frontend evidence remains 34 Node tests and 90 browser executions from the F
snapshot, followed by targeted revalidation for later changed behavior (not summed
as distinct tests). The UI runs actual source through Vite, not stale static assets.

## Independent review and fixes

Fixed initial review `685fb3f...aacd942`, independent contexts:

- Standards: 0 confirmed hard-standard breaches/actionable smells. Reviewer ran
  18 affected Node tests and 8 selected revision/transaction/replay/migration tests.
- Spec: 1 P2, independently reproduced in Chromium: a recovered saved answer absent
  from the new pool displayed its feedback on an unrelated unanswered item, and next
  skipped that item. The same issue could jump over items before a matched card.
  Reviewer independently ran 20 selected backend regressions (34 deselected).
- Standards also traced a behavior issue for Spec handling: a failed background
  lesson-list refresh returned before the active-reader branch. Parent reproduced
  this and the same mistake in Words; neither is represented as a Standards violation.

`5ff11ce` fixes ownership at those paths. Recovery inserts/moves the restored item
at the current index, so feedback/statistics belong to that item and every new
unanswered item remains. List refresh errors render alongside the current reader
or detail rather than replacing it. Actual red tests from `aacd942` failed for the
reported effects, then passed after the fixes.

The repeated error class was scoped to two changed loader consumers: list refresh
state was allowed to own detail lifetime. Existing page ownership was preserved;
JavaScript types or an ordering lint cannot reliably enforce this runtime lifecycle,
so the two real browser counterexamples enforce it. No generic resource framework,
global skill configuration or unrelated repository rules were added.

Additional final-source commands (Chrome + existing Playwright config):

```sh
EC_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome EC_OUTPUT_DIR=/tmp/ec-reliability-review-green EC_REPORT_PATH=/tmp/ec-reliability-review-green.json node frontend/node_modules/@playwright/test/cli.js test -c e2e/playwright.config.mjs 'reliability-frontend.spec.mjs$|p0-p1-practice.spec.mjs$' --grep 'lesson|course|practice retry|practice resumed|recovered answers keep|resuming a saved typed|content list loading'
EC_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome EC_OUTPUT_DIR=/tmp/ec-reliability-word-review EC_REPORT_PATH=/tmp/ec-reliability-word-review.json node frontend/node_modules/@playwright/test/cli.js test -c e2e/playwright.config.mjs 'reliability-frontend.spec.mjs$' --grep 'failed word-list refresh|word detail load|content list loading'
EC_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome EC_OUTPUT_DIR=/tmp/ec-reliability-reorder EC_REPORT_PATH=/tmp/ec-reliability-reorder.json node frontend/node_modules/@playwright/test/cli.js test -c e2e/playwright.config.mjs 'reliability-frontend.spec.mjs$' --grep 'recovered answers keep|resuming a saved typed'
EC_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome EC_OUTPUT_DIR=/tmp/ec-reliability-reader EC_REPORT_PATH=/tmp/ec-reliability-reader.json node frontend/node_modules/@playwright/test/cli.js test -c e2e/playwright.config.mjs 'reliability-frontend.spec.mjs$' --grep 'adding a lookup word'
node --test frontend/src/lib/practiceSession.test.mjs
```

Results respectively **20**, **6**, **4**, **2** browser executions and **1** Node
case passed, exit 0. Only the first command precedes the Words error-placement fix;
the second validates that fix. The third covers both absent and later-position
restored cards. Reader test is supplementary green acceptance of the state-ownership
refactor, not falsely claimed red/green. Source was fixed during each command.

## Remaining limits

- #17 fallback removed and annotation corrected, but null next_due is unreachable
  through currently valid public review commands; that exact null branch remains
  unverified. Normal scheduled adapter paths passed their selected tests.
- Lower-priority lesson_progress historical status, scheduler invalid State policy,
  and abbreviation/decimal-aware story sentence segmentation are deferred, as
  recorded per slice. The named high-impact changes are not replaced by new tickets.
- Actual production migration/deployment, live AI/TTS and physical speech devices,
  and unmarked local reverse-proxy identity hiding were not accepted here. AI management
  is intentionally limited to loopback direct callers; deployments must isolate
  those routes when a proxy hides peer identity (ADR-0009).
- Source delivery only: production static assets were not rebuilt. No frontend full
  build or full-project type check was started; package.json has no scoped frontend
  lint/type command. Use source-serving acceptance evidence as described above.
- No external tracker updates, push, PR, remote merge, deployment or global skill edit.

**本轮未运行全量测试和完整门禁。**

## Final review outcome

Incremental review fixed `aacd942...5ff11ce`, separate independent contexts:

- **Standards: 0 remaining actionable findings.** Reviewer independently ran
  `EC_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome EC_OUTPUT_DIR=/tmp/ec-standards-incremental-results EC_REPORT_PATH=/tmp/ec-standards-incremental-results/report.json frontend/node_modules/.bin/playwright test --config e2e/playwright.config.mjs e2e/reliability-frontend.spec.mjs --grep 'recovered answers keep|failed lesson progress refresh|failed word-list refresh'`
  — 6 passed, both viewports. No source changes by reviewer.
- **Spec: 0 remaining actionable findings; initial P2 resolved.** Independent
  Chrome run selected `committed attempt|recovered answers keep|failed lesson progress refresh|failed word-list refresh|adding a lookup word`
  from `reliability-frontend.spec.mjs` with the existing config — 10 passed,
  both viewports, report `/tmp/ec-spec-incremental-browser.json`. Absent/later
  restored targets no longer discard unanswered items. No source changes by reviewer.

No product source changed after these final reviews. Remaining limitations above
are preserved, including the unreachable #17 null branch and existing type diagnostics.
The two implementer worktrees were submitted for native archival after integration;
the delivery worktree and branch remain available. Original dev HEAD remains
`243f0c3358c220d9f9cf5169af1796cd4981782b` with its initial README/docs changes.
Final `git diff --check` on the delivered diff and verification notes passed.

## PR integration — user-authorized submission and merge

The follow-up request authorizes publishing a PR and merging it when conflict-free.
Fresh `origin/dev` is `fd994d613e57e7727af1d53047e5c3adc1c1bb41` (PR #88).
It was merged without conflicts in `7f2132e`; integration source head is
`509f14cc1dae51f4935f495a5d78f7c6b6cc2095`.

PR #88 adds exception-chain lint, originating-database background session factories,
legacy migration recovery and a source-browser dependency allowlist. Shared graduation
logic retains this round's null-translation protection and the new session factory.
New Ruff B904 diagnostics in three touched files were fixed by explicit causes;
HTTP status/detail are unchanged. One existing EL-08 callback fixture needed the
new explicit keyword parameter; its original `done.wait(5)` assertion remains.

Fresh merge verification (Python 3.12.3 / Node v24.21.0 / installed Chrome):

- `.venv/bin/python -m pytest tests/test_reliability_routers.py tests/test_reliability_services.py tests/test_graduation.py -q`
  — 61 passed on `7f2132e`. Covers this task's backend acceptance, migration/V3 and
  the combined graduation path. No backend business behavior changed afterward.
- The 34-case Node command documented above was rerun on `7f2132e`: 34 passed.
- `EC_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome EC_OUTPUT_DIR=/tmp/ec-reliability-pr-ui EC_REPORT_PATH=/tmp/ec-reliability-pr-ui.json node frontend/node_modules/@playwright/test/cli.js test -c e2e/playwright.config.mjs 'reliability-frontend.spec.mjs$' --grep 'committed attempt|recovered answers keep|failed lesson progress refresh|failed word-list refresh|adding a lookup word'`
  — 10 passed, both viewports, on `7f2132e`; frontend source unchanged afterward.
- Additional exception/migration/shared-background verification:

  ```sh
  .venv/bin/python -m pytest tests/test_learning_events.py::test_baseline_upgrade_recovers_after_ddl_and_partial_capture tests/test_memory_contract.py::test_contract_preflight_rejects_invalid_fsrs_without_changes tests/test_el08_lesson_recall_check.py::test_el08_practice_starts_post_commit_upgrade tests/test_el08_lesson_recall_check.py::test_el08_assistance_and_revision_conflict tests/test_cards_api.py::test_regenerate_incomplete_output_preserves_content_and_revision tests/test_cards_api.py::test_generate_non_array_cards_returns_upstream_failure tests/test_recognition_attempts.py::test_tampered_question_token_is_rejected tests/test_recognition_attempts.py::test_expired_question_token_is_rejected_before_first_save tests/test_recognition_attempts.py::test_same_submission_id_with_different_answer_conflicts -q
  ```

  Initial 28 passed / 1 failed: the old EL-08 fixture lambda rejected the new
  `session_factory` keyword. Updated only that fixture signature, then reran
  `tests/test_el08_lesson_recall_check.py::test_el08_practice_starts_post_commit_upgrade`:
  1 passed. No passing tests were relabeled as a rerun of the entire group.
- `.venv/bin/python scripts/agent_check.py --base dev --lint`
  — passed on `509f14c`, latest base `fd994d6`, 33 changed Python files formatted.
- `pyright --pythonpath .venv/bin/python app/routers/cards.py app/routers/listening.py app/services/practice.py tests/test_el08_lesson_recall_check.py`
  — 5 existing listening diagnostics, no new diagnostics; these are a subset of
  the previously reproduced baseline findings. Not a passing type-check claim.
- `git diff --check origin/dev...HEAD`: passed.

Independent integration review at fixed source `509f14c`:

- Standards: 0 remaining actionable findings; independently ran 3 exact null
  translation / old schema / post-commit upgrade tests, all passed.
- Spec: 0 remaining actionable findings; independently ran 7 affected tests,
  including real background database isolation and LLM context, all passed.
  Prior review conclusions for unchanged code and all stated limitations remain.

Only affected verification was run; no full test suite, full release gate or
production frontend build. Original checkout and its unrelated changes remain intact.
