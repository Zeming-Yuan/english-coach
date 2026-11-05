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
