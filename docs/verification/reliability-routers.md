# Router reliability slice — 2026-11-05

## Scope and baseline

- Worktree: `/home/clusteradmin/.codex/worktrees/reliability-routers/english-coach`.
- Branch: `codex/reliability-routers`; clean starting HEAD `ae38cb20ddec550d33258216f61083e755d32287`.
- Spec: `docs/verification/reliability-fixes.md`, R acceptance plus parent-coordinated
  `today._event_rows` ordering adapter for S #21. No services changed.
- Public test seams confirmed by user: HTTP API and service public functions.
- No remote writes, push, PR, deployment, full suite or complete gate run.

## Behavior changes and red/green evidence

All commands below ran from this worktree with `.venv/bin/python -m pytest`.
Each row was developed as an individual behavior slice; red used the failing
behavior before its minimal fix. `--maxfail=1` was used for initial red runs.

| Target → directly affected behavior | Exact test selector in `tests/test_reliability_routers.py` (`-q -k`) | Red result → green result |
| --- | --- | --- |
| #7 → history CPU/date-range bound | `history` | -1/0/367 accepted, extreme input overflowed → 4 passed; range 1–366 |
| #8 → optional translation malformed output | `malformed` | AttributeError for string sentences → 4 passed |
| #8 → rewritten story list session | `revised` | old session still exposed → 1 passed |
| #9 → two concurrent difficult toggles | `concurrent` | unique constraint IntegrityError → 1 passed, one true and one false; final API state false |
| #10 → mixed-case local word lookup | `lookup` | existing HeLLo not found as hello → passed |
| #10 → repeat cached lookup card ID | `cached_lookup` | KeyError card_id with baseline router restored → 1 passed after restoring fix |
| #11 → remote/proxied config writes and probes | `ai_management` | remote probe returned 200 → 8 passed, no probe/save |
| #11 → probe exception sanitization | `local_ai_probe` | restored old formatter leaked synthetic key/address → 2 passed with safe formatter restored |
| Legacy export timestamp | `legacy_export` | None → 1 passed |
| Missing-card memo GET/PUT agreement | `missing_card_memo` | GET 200 → 1 passed |
| TTS cache recency | `recency` | hot entry synthesized twice → 1 passed |
| TTS preload external transport error | `preload_transport` | RuntimeError escaped → 1 passed |
| Listening due queue precedence | `listening_selects` | new card 1 selected instead of due card 6 → 1 passed |
| S #21 cross-slice adapter | `same_time` | wrong goal 10 after wrong-first/right-second same-time events with reverse UUID order; R alone remains red until S statistics consumes saved_order |

The lookup-cache and sanitized-error regressions additionally restored the old
behavior temporarily, confirmed the reported failure, then restored the fix and
reran green. No old implementation remains in this branch.

`today._event_rows` supplies SQLite rowid as `saved_order` and reads events by
`occurred_at, rowid`; the S slice owns consuming this field. The cross-slice HTTP
test deliberately remains an integration requirement, not an expected failure marker.

## Decisions and limits

ADR-0009 records loopback-only PUT/test management, rejection of Forwarded,
X-Forwarded-* and X-Real-IP, and sanitized upstream failures. Existing custom
HTTP/HTTPS, private-network and loopback LLM endpoints remain supported. A local
reverse proxy that hides peer identity without any forwarding headers cannot be
recognized by this application; deployments must isolate management routes.

`tests/support/ec_env.py` now supplies a real loopback TestClient peer rather than
adding any production-only allowance for the string `testclient`.

Historical baseline behavior retained: story detail already invalidated a check
session after revision; playback already rejected incomplete TTS audio before
returning/caching it. The remaining changes address list/preload behavior.
`app/routers/scenes.py` does not exist; scenes service concerns were handed to S.

## Scoped verification

Snapshot: starting HEAD above plus this slice's router/test files; all product
source remained fixed after the final formatter/type adjustment. Documentation
was filled after command completion.

- `.venv/bin/python -m pytest tests/test_reliability_routers.py tests/test_ai_config_api.py tests/test_today.py tests/test_stats.py tests/test_adaptive_limit.py tests/test_stories.py tests/test_cards_api.py tests/test_memos.py tests/test_tts.py tests/test_listening.py tests/test_export.py tests/test_el13_story_reading_check.py tests/test_el06_migrate_content_contact.py -q -k 'not same_time_adaptive_sample_uses_saved_order'`
  — 156 passed, 1 deselected, exit 0. Covers changed APIs plus direct statistics,
  story-check/revision, export, listening, memo and TTS consumers. The additional
  cached-lookup regression was added after collection of this run and separately
  verified in the next command.
- `.venv/bin/python -m pytest tests/test_reliability_routers.py -q -k 'not same_time_adaptive_sample_uses_saved_order'`
  — final regression file: 27 passed, 1 deselected, exit 0.
- `.venv/bin/python -m pytest tests/test_reliability_routers.py -q -k same_time --maxfail=1`
  — 1 failed, 26 deselected before final cache test was added; expected goal 5,
  actual 10. Explicit cross-slice dependency on S, must run after integration.
- `.venv/bin/python scripts/agent_check.py --base dev --lint`
  — exit 0, verified origin/dev `685fb3f16840a553f10f42e22f42e7d87b08fda9`
  against HEAD `ae38cb20ddec550d33258216f61083e755d32287`, Ruff checks passed,
  12 Python files already formatted. First attempt failed remote fetch with a
  connection reset; retry fetched successfully, identified missing BLE001
  annotation on the external preload boundary; final attempt passed after fix.
- `pyright --pythonpath .venv/bin/python app/routers/ai_config.py app/routers/cards.py app/routers/export.py app/routers/listening.py app/routers/lookup.py app/routers/memos.py app/routers/stories.py app/routers/today.py app/routers/tts.py tests/test_reliability_routers.py tests/test_ai_config_api.py tests/support/ec_env.py`
  — exit 1: 8 existing diagnostics, none newly introduced. Explicit file arguments
  scope this check; the project-wide configured include set was not run. Initial
  invocation without `--pythonpath` could not resolve installed dependencies;
  rerun above uses the application virtualenv.
- Baseline comparison: original `ae38cb2` versions of export.py, listening.py,
  tts.py and ec_env.py copied with `git show` into `/tmp/reliability-router-types/`;
  `pyright --project pyrightconfig.json --pythonpath .venv/bin/python /tmp/reliability-router-types/export.py /tmp/reliability-router-types/listening.py /tmp/reliability-router-types/tts.py /tmp/reliability-router-types/ec_env.py`
  — exit 1, same 8 diagnostics: Session bind Connection.url, listening callable
  reassignment (3), narrowed command kind/source overrides (2), optional TTSChunk
  data key, and Settings `_env_file` typing. These unchanged findings remain outside
  the requested fixes.

Full suite and complete gates were not run. Real external AI/TTS requests,
production reverse-proxy deployment and browser acceptance were not run. HTTP
security tests use isolated clients with explicit peer IPs and synthetic faults.
Independent Standards/Spec review is owned by the parent after integration.
