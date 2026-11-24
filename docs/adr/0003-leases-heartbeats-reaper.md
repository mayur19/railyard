# ADR-0003: Leases with heartbeats and a reaper instead of long-running transactions

- Status: Accepted
- Date: 2026-11-24
- Tickets: RY-051, RY-045

## Context

A job can run for up to 24 hours (`maxTimeoutMinutes`). The runner executing it can crash, lose its host, or be partitioned from the database. The system must detect lost work and either retry or fail it, without a human, and without ever accepting a result from a runner that no longer owns the job.

## Decision Drivers

- Detect lost runners within tens of seconds, not at job timeout.
- Never hold a database transaction or connection for the duration of a job.
- Reject late results from a runner that lost ownership (fencing).
- Reuse the normal retry policy for crash recovery.

## Considered Options

1. Hold the row lock (`SELECT ... FOR UPDATE`) in an open transaction for the whole job.
2. Session-level advisory lock per job held by the runner's connection.
3. Time-bound lease (`lease_owner`, `lease_expires_at`) renewed by heartbeats, plus a reaper that settles expired leases.
4. Runner registry with liveness timestamps only (`runners.last_heartbeat_at`), reassigning all jobs of a dead runner.

## Decision Outcome

Chosen option: **3, leases + heartbeats + reaper**.

- Lease length `RUNNER_LEASE_SECONDS` (default 30, range 5-600). The runner heartbeats every `max(1 s, lease / 3)` with `UPDATE jobs SET lease_expires_at = ... WHERE id = $1 AND lease_owner = $2 AND status = 'running'`. A zero row count means ownership was lost: the runner aborts its `AbortController`, which terminates the step's process group, and **discards** the result (it does not call `completeJob`).
- Every runner runs the reaper at most every 10 s (`REAP_EVERY_MS`): it selects up to 100 `running` jobs with `lease_expires_at < clock_timestamp()` (served by the partial index `jobs_lease_idx`) and calls `completeJob(..., leaseOwner: null, result: 'failed', reason: 'lease expired (runner lost)')`. Because `completeJob` applies `outcomeAfterAttempt`, a job with remaining `retries` is requeued; otherwise it fails and dependents are resolved.
- `completeJob` from a runner passes its own name as `leaseOwner`; the update is applied only if the row still names that owner and is still `running`. This is the fencing check.
- `clock_timestamp()` (database clock) is used for every lease computation so runner clock skew is irrelevant.

### Consequences

- Positive: no long transactions; connection pool of 4 per runner is enough.
- Positive: crash recovery reuses the retry path, so an infrastructure failure consumes one attempt, which is visible in `attempt` and `failure_reason`.
- Positive: reaping is distributed; there is no singleton scheduler to keep alive.
- Negative: a runner that is alive but cannot reach Postgres for longer than the lease will have its work duplicated by a retry while it may still be running the step until its next failed heartbeat. Workspaces are per attempt (`<jobId>-a<attempt>`) so attempts do not share files, but external side effects of steps (deployments) can repeat. Environments and concurrency groups (RY-090, RY-095) must account for this.
- Negative: detection latency is lease + reaper interval (default worst case 40 s).
- Rejected: option 1 ties a connection and a transaction to each job for hours and loses everything on connection reset; option 2 cannot be inspected or fenced in SQL; option 4 cannot distinguish a slow job from a dead runner per job.
