# Task branches and integration

1. Read the ticket and completed dependencies through the issue tracker. Business dependencies determine required behavior; fetch the actual PR base independently.
2. Fetch `origin`, identify the target branch, and create/reuse an isolated task checkout from its remote ref or pinned SHA. Preserve dirty work in other checkouts. A completed predecessor ticket does not make local `dev` current.
3. Before editing in that checkout and before opening/updating a PR, run `.venv/bin/python scripts/agent_check.py --base dev`. Use the PR's actual target when different. It fetches and prints both SHAs; stale ancestry or fetch failure stops the check. Integrate into the task branch, then revalidate affected behavior.
4. Discover validation commands from package/build configuration, CI and development docs. Run `.venv/bin/python scripts/agent_check.py --base dev --lint` for changed Python; use the existing Pyright configuration and affected tests for behavior/type evidence. The guard is a baseline/lint check, not product acceptance.
5. Freeze source and HEAD while the E2E runner records fingerprints. Keep diagnostics outside tracked source; collect all results before changing source or committing evidence docs.
6. Before merging, fetch again, verify the latest target is an ancestor, and match the merge to the reviewed PR head. If the base moved, integrate and repeat the applicable verification/review. Keep the next ticket's checkout/context scoped to that ticket.

## Integration review

Pin a nonempty base-to-HEAD diff and the originating spec. Review only task changes and conflict resolutions. Trace both sides' intents through shared state, migrations, API responses, UI lifecycles and backup/restore; textual merge success does not prove behavior compatibility. Derive the affected regression set from these shared paths, including previously merged behavior. Record the base/head SHAs, executed checks, review findings and remaining unverified gates. A newly added migration must leave a usable upgrade path from each already delivered head.

For retrospective environment changes, use scoped self-review and applicable automated checks. Product slices retain their required independent Standards/Spec reviews. Keep product fixes in the originating ticket; retrospective work is limited to the Agent environment and protocol.

## Guardrail coverage

`Agent checks` CI executes the real PR head, checks fresh target ancestry, exercises the guard in disposable local Git repositories, and runs the existing Ruff check/format on changed Python. Local uncommitted and untracked Python are included. It does not modify source, integrate branches, commit, push or deploy. A stale branch fails with the two identities; choose the integration in the task checkout.

Type checks, application tests, browser acceptance and release/recovery checks remain scope-dependent evidence. A green Agent check alone cannot justify completing or merging a product ticket. CI/branch protection settings are separate: confirm the check ran; required-check enforcement is not implied by a workflow file.
