# Reliability service slice — 2026-11-05

Spec: `docs/verification/reliability-fixes.md`, S (#12–24).
Worktree: `reliability-services/english-coach`, branch `codex/reliability-services`.
Start: `ae38cb20ddec550d33258216f61083e755d32287` (scope documentation on
`685fb3f16840a553f10f42e22f42e7d87b08fda9`, including PR #87). Start was clean.
Only the files in this slice were changed. Parent performs integration and independent
Standards/Spec review; this branch does not push, create PRs, or update a tracker.

Environment: local Python 3.12 venv, pytest isolated SQLite files, ECEnv real Alembic
migrations and HTTP app, external LLM mocked at its provider boundary; no live AI calls.
Confirmed seams: public service functions and HTTP API. Fixtures may seed database
records or replace filesystem/provider boundaries. No private service function is tested.

## Red → minimal implementation → same test green

Each row below was run individually as
`.venv/bin/python -m pytest tests/test_reliability_services.py::<test_name> -q`.
Each listed red failed for the reported behavior; after the minimal implementation,
the same command completed with `1 passed`. Tests were added one behavior at a time.

| Item | Test name | Observed red / fixed behavior |
| --- | --- | --- |
| 24 | `test_cloze_matches_a_word_instead_of_a_substring` | `Con___enate` instead of whole `cat`; regex word boundaries, escaped literal target |
| 15 | `test_starter_batch_reuses_duplicates_and_owns_card_kind` | duplicate `kind` keyword TypeError; whitelist content fields, track batch words with autoflush disabled |
| 16 | `test_weighted_error_records_latest_failure_time` | timestamp remained 2000-01-01; repeated errors update UTC failure time |
| 19 | `test_non_ascii_question_signature_is_invalid_input` | compare_digest TypeError; reject non-ASCII signature as InvalidQuestionToken |
| 19 | `test_deep_question_json_is_invalid_input` | 20,000 nested arrays raised RecursionError; map decoder recursion failures to invalid input |
| 23 | `test_generator_keeps_only_one_card_per_requested_word` | two `cat` cards; deduplicate request and accepted generated rows |
| 23 | `test_generator_discards_chunks_of_a_rejected_example` | orphan chunks retained after example cleared; clear chunks too |
| 14 | `test_lesson_rejects_nontext_phonetic` | accepted list; reject nontext phonetic before persistence |
| 14 | `test_lesson_reuses_existing_word_regardless_of_case` | inserted `Hello` beside `hello`; reuse word card and canonical stored spelling |
| 13 | `test_revision_reads_refresh_a_previously_loaded_row` | identity-map row stayed at version 1; populate_existing for revision reads/maps |
| 13 | `test_overlapping_revision_writes_keep_both_increments` | controlled two-Session interleaving ended at 2; SQL atomic increment ends at 3 |
| 12 | `test_ai_sentence_null_translation_preserves_saved_translation` | existing translation and meaning became null; retain existing values |
| 20 | `test_write_transaction_preserves_business_error_when_rollback_fails` | rollback OSError hid business ValueError; keep business exception, attach rollback failure note |
| 20 | `test_write_transaction_reports_connection_failure_without_disguising_it` | connection OSError became generic clean-session RuntimeError; propagate actual failure |
| 21 | `test_adaptive_limit_uses_saved_order_for_identical_timestamps` | UUID sorting selected second answer; use saved_order, stable input order fallback |
| 22 | `test_lesson_replay_rejects_changing_weak_only` | replay returned 200 after selection changed; persist and compare weak_only |
| 22 | `test_delayed_replay_cannot_omit_frozen_targets` | empty targets replay returned 200; persist whether targets were explicit and check frozen targets |
| 18 | `test_scene_feedback_with_empty_templates_reports_unavailable` | HTTP 500; empty filesystem template catalogue now returns 422 |
| 14 follow-through | `test_lesson_word_cards_find_reused_card_with_different_case` | lesson target disappeared after reuse; case-insensitive revision/card mapping |
| low: scenes | `test_scene_catalogue_rejects_invalid_slot_structure` | null slot raised AttributeError; validate slot mapping/excluded words before judging templates |
| low: estimates | `test_budget_plan_rejects_nonpositive_estimate` | ZeroDivisionError; require complete finite positive numeric seconds and known basis |
| low: feedback assert | `test_scene_feedback_missing_saved_answer_reports_unavailable` | missing saved answer became HTTP 500; explicit unavailable error returns 422 |

The first deep-JSON probe (2,000 levels) was already rejected without a decoder error;
20,000 levels reproduced the reported defect. An initial exploratory unrated legacy
review probe used invalid rating 0 and was removed: it failed protocol validation,
not the reported next_due behavior. An unavailable unqualified `python` executable
was corrected to the repository `.venv/bin/python`; no source was changed by it.

## Migration and backup compatibility

`reliability_practice_weak_only` is an additive migration from the delivered
`el18_practice_durations` head. It adds `weak_only` and `targets_explicit` booleans.
The existing model registry exports and restores both columns; FullPracticeSession
validates and supplies defaults for older V3 documents. No second collection, rule
identity overload, or destructive downgrade is introduced.

Additional public acceptance tests verify old-head upgrade with an existing row,
weak-only V3 restore/replay conflict, explicit-target V3 restore/conflict, and older
V3 backups omitting the fields. Those compatibility tests were green after the
implementation and are supplementary acceptance checks, not claimed as red/green.
Old databases/backups have no trustworthy record of these original choices; they
use false defaults. Historical weak-only selection or explicit-target intent cannot
be reconstructed. New sessions preserve these choices across restarts and restore.

## Scope and limitations

- #17: removed the synthetic `now()` fallback and declared `ReviewResult.next_due`
  nullable. Existing public submit_review requires a valid 1–4 self rating and always
  schedules; its underlying null-result branch is currently unreachable through a
  valid public command. That branch has no real-path regression proof; existing
  adapter tests cover normal scheduled compatibility. No internal collaborator was
  mocked merely to manufacture this path.
- #21 integration: R owns today._event_rows and supplies `saved_order` from SQLite
  rowid. The statistics service consumes it here; R's HTTP test must be rerun after
  parent integrates both slices. Card-event/export ordering was already rowid-based
  at the starting baseline and was preserved.
- Lower-priority lesson_progress generated/status and scheduler State validation
  were not changed: choosing a fallback for historical/invalid state is outside the
  confirmed high-impact service corrections. No whole-repository audit was done.
- No performance claim, benchmark, live model acceptance, browser test, destructive
  downgrade, or production migration was performed in this service slice.
- 本轮未运行全量测试和完整门禁。

## Scoped verification commands and results

The command-to-behavior mapping is intentionally limited:

- Core generators, revisions, adapter, scoring, errors, practice replay and statistics:

  ```sh
  .venv/bin/python -m pytest tests/test_reliability_services.py tests/test_scoring.py tests/test_starter_cards.py tests/test_card_generator.py tests/test_graduation.py tests/test_error_cards.py tests/test_review_submission.py tests/test_el01_expand_revisions_and_v3.py tests/test_el07_lesson_goals_and_progress.py tests/test_el08_lesson_recall_check.py tests/test_el09_delayed_recall_check.py tests/test_el16_bounded_ai_scene_feedback.py tests/test_adaptive_limit.py tests/test_activity_history.py tests/test_stats.py -q
  ```

  **281 passed in 342.82s.** This run began before the supplemental slot/estimate/
  missing-answer tests were added; the later run below verifies those source changes.

- New regression file, scene validation/feedback and workload estimates:

  ```sh
  .venv/bin/python -m pytest tests/test_reliability_services.py tests/test_el14_three_turn_drink_scene.py tests/test_el15_intro_and_directions_scenes.py tests/test_el16_bounded_ai_scene_feedback.py tests/test_el17_time_budget_daily_plan.py tests/test_el18_personal_active_time_estimate.py -q
  ```

  Initial run found `test_el14_schema_rollback_refuses_to_remove_scene_history`
  expected the old migration's downgrade refusal text. The new head correctly
  refuses first; its message assertion was updated. The exact failed test was rerun:

  ```sh
  .venv/bin/python -m pytest tests/test_el14_three_turn_drink_scene.py::test_el14_schema_rollback_refuses_to_remove_scene_history -q
  ```

  **1 passed in 1.54s**, including unchanged saved scene snapshot after refusal.

- Changed Python lint/format and fresh target ancestry:

  ```sh
  .venv/bin/python scripts/agent_check.py --base dev --lint
  ```

  Passed with origin/dev `685fb3f16840a553f10f42e22f42e7d87b08fda9`, HEAD
  `ae38cb20ddec550d33258216f61083e755d32287`; all 19 then-changed Python files
  passed Ruff and format checks. The subsequently changed historical EL-14 test
  separately passed Ruff check/format; final guard is repeated before commit.

- Changed-file type checking (no repository-wide type run):

  ```sh
  pyright --pythonpath .venv/bin/python app/models/practice.py app/schemas/backup_v3.py app/services/card_generator.py app/services/content_revisions.py app/services/error_tracking.py app/services/graduation.py app/services/lesson_generator.py app/services/practice.py app/services/questions.py app/services/review_submission.py app/services/scene_feedback.py app/services/scenes.py app/services/scoring.py app/services/starter_cards.py app/services/statistics.py app/services/time_budget.py app/services/write_transaction.py tests/test_reliability_services.py alembic/versions/reliability_practice_weak_only.py
  ```

  **13 errors, 0 warnings**, all existing at baseline: questions 1, review_submission
  1, statistics 11. No new diagnostic remains in the new code/tests. Baseline proof:
  `git show ae38cb2:app/services/{questions,review_submission,statistics}.py` was
  saved as three files under `/tmp/reliability-services-baseline/`, then:

  ```sh
  pyright --project pyrightconfig.json --pythonpath .venv/bin/python /tmp/reliability-services-baseline/questions.py /tmp/reliability-services-baseline/review_submission.py /tmp/reliability-services-baseline/statistics.py
  ```

  reproduced the same **13 errors, 0 warnings**. This is a reported pre-existing
  type-check gap, not a passing type-check claim.

- `git diff --check`: exit 0.

Second regression command completed with **204 passed, 1 failed in 233.89s**;
the sole failure was the old-head downgrade-message assertion described above,
whose corrected exact test passed. No other regression failed. The final snapshot
therefore has passing evidence for each selected behavior, without rerunning the
204 unchanged passing tests. This includes all 26 new public-seam regressions and
compatibility checks. These test groups overlap and are not added as a unique total.

Final `.venv/bin/python scripts/agent_check.py --base dev --lint`: exit 0,
`All checks passed!`, **20 files already formatted**, same origin/dev and HEAD.
Final `git diff --check`: exit 0. The additional modified historical EL-14 file
was checked with `pyright --pythonpath .venv/bin/python tests/test_el14_three_turn_drink_scene.py`:
**0 errors, 0 warnings**. No product source changed after those final checks.
Independent two-axis review is pending parent integration, not claimed complete here.
