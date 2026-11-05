# Reliability fixes — 2026-11-05

Source: user-supplied audit and implementation instructions in this chat. Baseline:
Initial local HEAD: `243f0c3358c220d9f9cf5169af1796cd4981782b`.
Fetched implementation/review baseline: `685fb3f16840a553f10f42e22f42e7d87b08fda9`
(`origin/dev`, includes PR #87). Re-check reported defects against this version;
already fixed behaviors are historical evidence, not new changes in this diff.
Original checkout has unrelated README/docs edits; preserved there, excluded here.
No remote tracker writes, pushes, PRs, merges or deployments authorized by this task.

Confirmed test seams: HTTP APIs, service public functions, frontend exported lib
functions, observable hook state and page behavior. One failing behavior test,
minimal fix, same test green, then next behavior. Only affected checks; no full suite.

## Task graph and acceptance

Independent implementation slices start at the pinned baseline in separate worktrees.
Integrate in order R, S, F; review integrated fixed diff along Standards and Spec axes.

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
