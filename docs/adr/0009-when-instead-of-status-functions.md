# ADR-0009: `when: on_success | on_failure | always` instead of status functions in expressions

- Status: Accepted
- Date: 2026-11-24
- Tickets: RY-041, RY-045

## Context

Some jobs must run only when everything upstream passed (default), some only when something failed (notify, collect diagnostics), some regardless (cleanup). Other CI systems express this with status functions inside conditions (`if: failure()`, `if: always() && ...`). In Railyard, `if:` is evaluated at **planning** time (ADR-0006, ADR-0008), before any job has run, so outcome-dependent logic cannot live there without making `if:` evaluate twice with different meanings.

## Decision Drivers

- Keep planning pure and complete before execution starts.
- Outcome rules evaluated in one place, at completion time, under the run lock (ADR-0004).
- Clear semantics for `allow-failure`, cancellation and transitive failures.
- Small surface that is easy to explain and test.

## Considered Options

1. Status functions (`success()`, `failure()`, `always()`, `cancelled()`) in `if:`, re-evaluated at runtime.
2. A `when` enum on the job, resolved by the scheduler at completion time; `if:` remains a planning-time filter.
3. Per-edge conditions (`needs: [{ job: build, on: failure }]`).

## Decision Outcome

Chosen option: **2, a `when` enum**, resolved by `resolveBlockedJobs` in `packages/shared/src/jobs/state.ts`. A blocked job is decided only when every dependency is terminal:

| `when`                 | Becomes `queued` when                                                                    | Otherwise                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `on_success` (default) | every dependency is satisfied: `succeeded`, or `failed`/`timed_out` with `allow-failure` | `skipped`; `cancelled` if any dependency is `cancelled`        |
| `on_failure`           | any **transitive** ancestor is `failed` or `timed_out` without `allow-failure`           | `skipped`; `cancelled` if any direct dependency is `cancelled` |
| `always`               | all dependencies terminal, whatever their status (including `cancelled`)                 | never skipped                                                  |

`resolveBlockedJobs` iterates to a fixed point so a skip propagates down a chain in one call, and it is pure (returns changes, does not mutate).

Run status (`deriveRunStatus`): non-terminal jobs make the run `running` (or `queued` if nothing has started); otherwise `cancelled` if any job is cancelled, `failed` if any job failed or timed out without `allow-failure`, else `succeeded`. Skipped jobs never fail a run.

### Consequences

- Positive: planning and execution semantics are cleanly separated; `if:` never depends on outcomes.
- Positive: `on_failure` uses transitive ancestry, so a notify job at the end of a long chain fires even when the failure was three levels up and intermediate jobs were skipped.
- Positive: completely covered by unit tests in `state.test.ts` and end to end in `runner.db.test.ts`.
- Negative: less expressive than combining status and data conditions in one expression (for example "on failure, but only on main"). Users combine `if:` (data, planning time) with `when` (outcome, runtime), which covers that case.
- Negative: `cancelled` today only arises by cascade; explicit cancellation arrives with RY-043.
- Rejected: option 1 gives `if:` two evaluation phases and makes the plan incomplete; option 3 multiplies edge types and complicates the run graph UI.
