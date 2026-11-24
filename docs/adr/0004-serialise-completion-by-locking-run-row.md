# ADR-0004: Serialise job completion by locking the run row

- Status: Accepted
- Date: 2026-11-24
- Tickets: RY-041, RY-042

## Context

When a job finishes, its blocked dependents may become `queued`, `skipped` or `cancelled`, and the run status must be recomputed. Two sibling jobs that share a dependent can finish at the same instant on different runners. Under READ COMMITTED, if each completion only locks its own job row, each transaction sees the other sibling as still `running` and neither promotes the dependent: the run hangs with a job in `blocked` forever. The reaper and (later) the cancel endpoint (RY-043) perform the same operation.

## Decision Drivers

- No lost promotions under any interleaving.
- Simple to reason about; one code path for runner, reaper and cancel.
- Contention limited to a single run, never global.
- Dependency resolution logic stays pure and testable (`resolveBlockedJobs`).

## Considered Options

1. Lock only the finishing job row; promote dependents with per-dependent conditional updates.
2. SERIALIZABLE isolation for completion transactions with retry on serialization failure.
3. Lock the parent `pipeline_runs` row first (`SELECT ... FOR UPDATE OF r`), then lock and settle the job, then recompute all blocked jobs of the run from a consistent snapshot.
4. Per-run advisory lock (`pg_advisory_xact_lock(hashtext(run_id))`).
5. Counter of unfinished dependencies per job decremented atomically.

## Decision Outcome

Chosen option: **3, lock the run row**. `completeJob` in `apps/api/src/modules/runs/run-progress.ts` executes in one transaction:

1. `SELECT r.id FROM pipeline_runs r JOIN jobs j ON j.run_id = r.id WHERE j.id = $1 FOR UPDATE OF r`
2. `SELECT ... FROM jobs WHERE id = $1 FOR UPDATE`; return `applied: false` unless `status = 'running'` and the lease owner matches (or the caller is a system actor).
3. Requeue (retry) or settle the job and close out its steps.
4. `advanceRun`: load all jobs of the run, call the pure `resolveBlockedJobs` (fixed point), apply changes grouped by target status with `WHERE status = 'blocked'` guards, call `deriveRunStatus`, update the run.
5. `pg_notify` for every changed job; notifications are delivered only on COMMIT.

### Consequences

- Positive: completions within a run are totally ordered, so the second transaction always sees the first one's result; promotion is never lost.
- Positive: different runs complete fully in parallel; the lease path does not take the run lock (it only updates the run row from `queued`), so leasing is not blocked by completions except momentarily on the same run row.
- Positive: the dependency rules live in one pure function covered by `packages/shared/test/state.test.ts`.
- Negative: `advanceRun` reads every job of the run on every completion: O(V + E) per completion, O(V·(V + E)) for the whole run. With `maxPlannedJobs = 1000` this is bounded; incremental resolution can replace it if RY-149 or RY-141 show it matters.
- Negative: very wide fan-in (hundreds of siblings finishing together) serialises on one row; each critical section is a few milliseconds.
- Rejected: option 1 has the lost-promotion race; option 2 needs retry loops around side-effect-free but expensive work and makes failures non-deterministic; option 4 works but is invisible in `pg_locks` row terms and easier to forget in new code paths; option 5 cannot express `on_failure` (which depends on transitive ancestors) or `always`.
