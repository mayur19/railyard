# ADR-0008: Implicit stage dependencies and cascade exclusion of jobs whose needs were excluded

- Status: Accepted
- Date: 2026-11-24
- Tickets: RY-034, RY-035

## Context

Pipelines combine two dependency models: ordered `stages` (everything in `test` waits for `build`) and explicit `needs` (a DAG that may skip ahead). Jobs can be removed from a particular run by a false `if:` (for example a deploy job only on `main`). The planner must decide (a) what a job without `needs` depends on, (b) what happens when a stage is empty in this run, and (c) what happens to a job whose explicit `needs` names a job that is not in the run at all.

## Decision Drivers

- Simple pipelines should need no `needs:` at all.
- Explicit `needs` must override stage ordering, including `needs: []` meaning "start immediately".
- A run must never contain a job waiting on something that will never exist.
- The reason a job is not in a run must be visible to the user.

## Considered Options

1. Stages only (strict barrier between stages).
2. Explicit `needs` only (no stages).
3. Implicit dependency on every job of the previous **non-empty** stage when `needs` is absent; explicit `needs` replace it; explicit needs on a fully excluded job exclude the dependent too (cascade), recording the reason.
4. Like 3, but silently drop excluded entries from `needs` and keep the dependent.

## Decision Outcome

Chosen option: **3**.

- `JobSpec.needs === null` means implicit. `resolveNeeds` walks stages backwards from the job's stage and depends on all instances of the first stage that has at least one instance in this run. Empty stages (all jobs excluded by `if:`) are skipped over, so `deploy` still waits for `test` when `integration` is empty.
- `needs: []` means no dependencies; `needs: [x]` means every instance of `x`. The validator forbids `needs` pointing to a later stage (`later_stage`), self-dependency, unknown jobs and cycles.
- Planning processes jobs in explicit-needs topological order. If any explicit need has zero instances (excluded by `if:` or itself cascaded), the job is excluded with reason `needs '<id>', which is excluded from this run`. Jobs with a false `if:` are excluded with reason `if condition is false`. Both appear in `plan.excluded` and in the run detail.
- A run whose plan contains zero jobs is rejected with `422 EMPTY_PLAN` and the exclusion list.

### Consequences

- Positive: stage-only pipelines work without `needs`; DAG pipelines can bypass stages; a run graph never contains unsatisfiable dependencies.
- Positive: cascade exclusion is a planning-time decision, distinct from runtime `skipped` (a dependency that ran and failed). The UI can show "not in this run" separately from "skipped".
- Negative: implicit dependencies create a complete bipartite edge set between adjacent stages, so two adjacent stages of 500 instances yield 250 000 edges. Acceptable within `maxPlannedJobs`, benchmarked under RY-149.
- Negative: users may expect option 4 (run anyway when an optional dependency is absent). Optional needs can be added later as an explicit flag without changing the default.
- Rejected: options 1-2 each force one style on everyone; option 4 hides surprising behaviour (a deploy running without its gate).
