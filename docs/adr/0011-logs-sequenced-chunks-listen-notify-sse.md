# ADR-0011: Logs as sequenced chunks in Postgres, fanned out with LISTEN/NOTIFY and streamed over SSE with Last-Event-ID resume

- Status: Accepted
- Date: 2026-11-24
- Tickets: RY-060, RY-061, RY-123; RY-064 (archival), RY-066 (fan-out at scale), RY-144 (HA)

## Context

Developers watch job output live and expect to scroll back to the beginning, reload the page, or lose Wi-Fi without missing lines. Runners and the API are separate processes, possibly on separate hosts, sharing only Postgres. Logs must survive runner crashes (partial output is the most valuable output of a crashed job) and must be ordered across retries of the same job.

## Decision Drivers

- No gaps and no duplicates across reconnects.
- Durable as soon as written; visible to viewers within one second (QA-05).
- No extra infrastructure (no broker, no object store) for the first release.
- One subscription mechanism per API process regardless of viewer count.
- Bounded storage per job.

## Considered Options

1. Runner writes to local files; API tails them over a shared filesystem.
2. Runner pushes lines to the API over HTTP/WebSocket; API relays to viewers and persists.
3. Redis Streams or another broker for live fan-out, Postgres or files for history.
4. Runner inserts sequenced chunks into `job_log_chunks` and issues `pg_notify`; the API holds one LISTEN connection, and each SSE stream reads `seq > lastSeq` from Postgres on notification.
5. WebSockets instead of SSE for delivery.

## Decision Outcome

Chosen option: **4 with SSE**.

- **Write path** (`runner/log-writer.ts`): output is masked (ADR-0012), buffered and coalesced per stream, and flushed every 250 ms or at 64 KiB as one `INSERT ... SELECT FROM jsonb_to_recordset(...)` followed by `pg_notify('railyard_logs', {jobId, seq})`. `seq` is per job and continues across attempts (`firstSeq = max(seq) + 1`); `attempt` is stored per chunk. Output beyond 5 MiB per attempt is dropped after a single `[railyard] log truncated` system line.
- **Fan-out** (`modules/logs/log-hub.ts`): one dedicated `pg.Client` per API process LISTENs on `railyard_logs` and `railyard_jobs`, opened lazily, reconnecting after 1 s on error while subscribers remain, dispatching to in-process subscribers keyed by job id.
- **Delivery** (`modules/logs/sse.ts`): `GET /api/runs/:id/jobs/:jobId/logs/stream` responds `text/event-stream` with `X-Accel-Buffering: no`. It subscribes **before** back-filling; every notification triggers `drain()` (batches of 500 by `seq`) on a single promise chain; frames are `event: log` with `id: <seq>`, `event: status`, and `event: end` once the job is terminal. `retry: 2000` and a 15 s comment heartbeat keep proxies and browsers healthy. On reconnect the browser sends `Last-Event-ID`, which overrides the `after` query parameter.
- **History** is served by `GET .../logs?after=&limit=` with `meta.lastSeq` and `meta.complete`.

### Consequences

- Positive: a notification is only a wake-up hint; correctness comes from reading by `seq` from durable storage, so lost or coalesced notifications cannot create gaps.
- Positive: NOTIFY is transactional and delivered after COMMIT, so viewers never see uncommitted output.
- Positive: SSE works through standard HTTP proxies, reuses cookies for auth, and has built-in resume; WebSockets would need a custom resume protocol and CSRF handling on upgrade.
- Negative: Postgres stores hot log data. At 5 MiB per attempt and heavy usage the table grows quickly; archival to compressed files with retention is RY-064, retention jobs RY-143.
- Negative: each subscriber issues its own `SELECT` per notification; many viewers on one chatty job multiply queries. Shared reads, batching and backpressure are RY-066.
- Negative: NOTIFY payloads are limited to 8000 bytes, which is why payloads carry only ids, never content.
- Negative: with multiple API nodes each node LISTENs independently, which works, but failover and connection budgeting are RY-144.
- Rejected: option 1 requires a shared filesystem; option 2 makes the API a write bottleneck and loses output if the API restarts mid-job; option 3 adds a service for a problem Postgres already solves at our scale.
