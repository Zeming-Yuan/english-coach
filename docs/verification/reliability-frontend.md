# Frontend reliability — 2026-11-05

Baseline `685fb3f16840a553f10f42e22f42e7d87b08fda9`; implementation worktree
`/home/clusteradmin/.codex/worktrees/reliability-fixes/english-coach`.
User confirmed exported library functions, hook state and visible page behavior as seams.
No production asset build or full release gate was run.

## Behavior and red/green evidence

One failing behavior was reproduced, minimally fixed, and rerun before the next.
Node commands use `node --test` with the named file and `--test-name-pattern`;
browser commands use the existing Playwright config, exact filename anchor and
`--project desktop --grep '<named behavior>'` during development.

| Target | Regression file / named behavior | Observed red → green |
| --- | --- | --- |
| #1 direct contact | contacts.test.mjs / newly visible revision | retries old version and rejects → sends new version/new UUID |
| #1 feedback contact | contacts.test.mjs / fresh feedback lookup | version 1 reused → version 2 |
| #2 | contacts.test.mjs / pending contact ids | denied scope survives success → one normalized scope, then empty |
| #3 duration rejection | learning.test.mjs / duration observation notification | unhandled rejection → saved answer unaffected |
| #3 preparation | reliability-frontend.spec.mjs / preparation failure | second submit blocked by ghost pending → can prepare again |
| #3 saved recovery | same / committed attempt | remount failed → idle, no durable pending |
| #4 enumeration | durations.test.mjs / corrupted duration | [] → intact later sample visible |
| #4 cancellation | durations.test.mjs / discard aborts | no aborted signal → abort, late old result cannot remove new retry |
| #5 partial payload | practiceSession.test.mjs / partial today | TypeError → vocabulary fallback |
| #5 FSRS error | browser / failed FSRS write | success/stat counted despite failed save → readable save error, no credit |
| #5 skip error | browser / rejected custom skip | rejected promise → readable error, no progress |
| #5 recovered stats | browser / resuming a saved typed answer | count 0 → count 1; second resume does not increment |
| #6 network | api.test.mjs / network failures | English TypeError → Chinese connection error; AbortError preserved |
| #6 empty response | api.test.mjs / empty successful | SyntaxError → null for 204/empty 200 |
| List loads | browser / content list loading | empty-content state after 503 → visible error and retry, three pages |
| Detail/action | browser / word detail load | opaque failed load → readable error/retry; delete failure notified |
| Feedback order | browser / last practice answer | summary while feedback visible → summary only after view-results action |
| Empty/missing | browser / empty study queues | blank Study / crashed Practice → usable messages |
| Add JSX | browser / add-word results | tea &amp; coffee → tea & coffee |
| Starter exclusion | browser / starter requests | two calls → one call during in-flight save |
| Visibility ref | browser / answer mounted after | no observation → one visible-contact request |
| UUID fallback | learning.test.mjs / randomUUID unavailable | TypeError → valid v4 via getRandomValues, reused by timing/TTS/Study |
| Lookup failure | browser / word lookup distinguishes | missing → error state; both consumer panels show retry instruction |
| Audio letters | storyAudio.test.mjs / decomposition | Straße/ø dropped → Strasse/o |
| Advice targets | roundOutcomes.test.mjs / malformed workload targets | undefined accepted → reject nonpositive/noninteger/nonfinite targets |
| Assistance | assistance.test.mjs / malformed assistance | corrupt storage remains → invalid removed, valid flags deduplicated |

Mixed statistics now read the submitted `record.items[record.idx]`, and StoryRead
keeps library additions in local React state rather than mutating the parent prop.
These ownership corrections preserve visible behavior; existing mixed-recovery and
reader checks protect their consumers, rather than asserting private component internals.

Retry and resumed-confirmation exclusion already existed in PR #87; this round
reran those actual interleavings in p0-p1-practice.spec.mjs, rather than claiming
those earlier fixes as new work.

A self-review caught a new background lesson-refresh unmount caused by sharing
initial-loading state. `refreshing lesson progress keeps the current reader mounted`
first failed while the second list request was held, then passed after preserving
the reader during refresh. Words background refresh follows the same rule.

## Actual scoped verification

Environment: Linux, installed project Node and dependencies, `/usr/bin/google-chrome`.
Vite serves actual source components in isolated temporary caches; no full app build.

1. `node --test frontend/src/lib/api.test.mjs frontend/src/lib/assistance.test.mjs frontend/src/lib/contacts.test.mjs frontend/src/lib/durations.test.mjs frontend/src/lib/learning.test.mjs frontend/src/lib/practiceSession.test.mjs frontend/src/lib/roundOutcomes.test.mjs frontend/src/lib/storyAudio.test.mjs frontend/src/lib/tts.test.mjs frontend/src/lib/utils.test.mjs`
   — 34 passed, exit 0. Source snapshot before the final background-refresh adjustment;
   that adjustment only changes two views and does not affect these libraries.
2. `EC_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome EC_OUTPUT_DIR=/tmp/ec-reliability-ui-final EC_REPORT_PATH=/tmp/ec-reliability-ui-final.json node frontend/node_modules/@playwright/test/cli.js test -c e2e/playwright.config.mjs 'reliability-frontend.spec.mjs$|p0-p1-practice.spec.mjs$|p0-p1-data-safety.spec.mjs$'`
   — 90 passed, both viewports, exit 0. Covers changed learning/contact/lookup consumers,
   existing recovery/race regressions, and 13 new browser behaviors. Source fixed during run.
3. After final background-refresh adjustment:
   `EC_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome EC_OUTPUT_DIR=/tmp/ec-reliability-green EC_REPORT_PATH=/tmp/ec-reliability-green.json node frontend/node_modules/@playwright/test/cli.js test -c e2e/playwright.config.mjs 'reliability-frontend.spec.mjs$' --grep 'refreshing lesson progress|content list loading|word detail load'`
   — 6 passed, both viewports, exit 0. Earlier unchanged tests are not relabeled as rerun.

Initial test-harness failures (JSX in a virtual .js module, then a hidden details-menu
button) were corrected before interpreting behavior. The hidden-menu run was explicitly
interrupted, not counted as passed. An early feedback red run overlapped an edit;
its subsequent green and the fixed-source 90-case run are the acceptance evidence.

No frontend lint/type command is configured in package.json. Source transpilation
and real browser execution provide scoped parsing/runtime evidence. No whole-app
production build was started. Production static assets therefore remain unchanged.

Low-priority abbreviation/decimal-aware story sentence segmentation remains deferred;
this round only fixes the explicitly named letters. Real speech/audio devices and
remote services were not exercised. Missing IntersectionObserver fails conservatively
without synthesizing a visible contact. No global skills or configuration were edited.

**本轮未运行全量测试和完整门禁。**
