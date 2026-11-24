# ADR-0002: PostgreSQL as the job queue with FOR UPDATE SKIP LOCKED

- Status: Accepted
- Date: 2026-11-24
- Tickets: RY-050

## Context

Queued jobs must be handed to runner processes exactly once, in FIFO order, with any number of runners polling concurrently from one or more hosts. The state of a job (queued, running, finished) is already a row in `jobs`, and the transition to `running` must be atomic with setting the lease owner, incrementing `attempt`, marking the run as running and emitting a notification. Self-hosted operators should not have to run a separate broker.

## Decision Drivers

- Exactly-once hand-off per attempt; no double execution under concurrency.
- Atomicity between "dequeue" and "state change" (no dual-write between a broker and the database).
- No additional infrastructure for operators.
- Predictable latency as job history grows.
- FIFO fairness within the queue (fair-share across projects is a later concern, RY-097).

## Considered Options

1. Redis list / stream (BRPOPLPUSH, consumer groups) plus Postgres for state.
2. RabbitMQ or another AMQP broker plus Postgres for state.
3. Postgres row locking: `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1` inside the lease transaction.
4. Postgres advisory locks keyed by job id.
5. A single dispatcher process in the API assigning jobs to runners.

## Decision Outcome

Chosen option: **3, Postgres with `FOR UPDATE SKIP LOCKED`**.

```sql
WITH next AS (
  SELECT id FROM jobs WHERE status = 'queued'
  ORDER BY queued_at, id FOR UPDATE SKIP LOCKED LIMIT 1
)
UPDATE jobs j SET status = 'running', attempt = j.attempt + 1, lease_owner = $1,
       lease_expires_at = clock_timestamp() + make_interval(secs => $2), ...
FROM next WHERE j.id = next.id RETURNING ...
```

In the same transaction the parent run moves `queued -> running` and `pg_notify('railyard_jobs', ...)` is issued. The partial index `jobs_queue_idx ON jobs (queued_at, id) WHERE status = 'queued'` keeps the scan proportional to queued rows only. A table-level `CHECK ((status = 'running') = (lease_owner IS NOT NULL))` makes "running without an owner" unrepresentable.

### Consequences

- Positive: dequeue and state change commit together, so a crash between them is impossible; no outbox needed for the hand-off.
- Positive: runners never block each other; a locked candidate is skipped, not waited on.
- Positive: operators run one stateful service.
- Negative: polling. Idle runners query every `RUNNER_POLL_MS` (default 1000 ms). At 50 runners that is 50 cheap index probes per second, acceptable; LISTEN-driven wake-up is an optimisation if the load test (RY-141) shows otherwise.
- Negative: label matching (`runs-on`, RY-053), priorities (RY-098) and fair-share (RY-097) must be expressed in SQL ordering and filtering, which makes the lease query more complex and needs dedicated indexes.
- Negative: queue throughput is bounded by Postgres write throughput; the target ceiling (10 000 queued jobs, 50 runners) is well within it.
- Rejected: options 1-2 introduce dual writes and another service; option 4 does not compose with row filtering and leaks locks on connection reuse; option 5 is a single point of failure and duplicates what row locks already provide.
