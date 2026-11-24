# Architecture Decision Records

Decisions that shape Railyard, recorded in [MADR](https://adr.github.io/madr/) format: Status, Context, Decision Drivers, Considered Options, Decision Outcome, Consequences. Each record names the backlog tickets ([../planning/backlog.md](../planning/backlog.md)) that implement or extend it.

Statuses: **Proposed** (under discussion), **Accepted** (in force), **Superseded by ADR-NNNN**, **Deprecated**. Records are immutable once accepted; a changed decision gets a new record that supersedes the old one.

## Index

| ADR                                                             | Title                                                                          | Status   | Kind                      |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------- | ------------------------- |
| [0001](0001-modular-monolith-npm-workspaces.md)                 | Modular monolith in npm workspaces with a pure shared domain package           | Accepted | Structural                |
| [0002](0002-postgres-job-queue-skip-locked.md)                  | PostgreSQL as the job queue with `FOR UPDATE SKIP LOCKED`                      | Accepted | Domain: scheduling        |
| [0003](0003-leases-heartbeats-reaper.md)                        | Leases with heartbeats and a reaper instead of long-running transactions       | Accepted | Domain: scheduling        |
| [0004](0004-serialise-completion-by-locking-run-row.md)         | Serialise job completion by locking the run row                                | Accepted | Domain: consistency       |
| [0005](0005-in-house-pipeline-schema-validator.md)              | In-house pipeline schema validator with path-addressed issues and line numbers | Accepted | Domain: pipeline language |
| [0006](0006-in-house-expression-language.md)                    | In-house expression language for `if` and `${{ }}`                             | Accepted | Domain: pipeline language |
| [0007](0007-matrix-include-exclude-semantics.md)                | Matrix expansion semantics for include and exclude                             | Accepted | Domain: pipeline language |
| [0008](0008-implicit-stage-dependencies-cascade-exclusion.md)   | Implicit stage dependencies and cascade exclusion                              | Accepted | Domain: planning          |
| [0009](0009-when-instead-of-status-functions.md)                | `when: on_success / on_failure / always` instead of status functions           | Accepted | Domain: scheduling        |
| [0010](0010-bash-steps-detached-process-group-no-containers.md) | Bash steps in a detached process group, scratch environment, no containers     | Accepted | Domain: execution         |
| [0011](0011-logs-sequenced-chunks-listen-notify-sse.md)         | Logs as sequenced chunks + LISTEN/NOTIFY + SSE with `Last-Event-ID`            | Accepted | Domain: logs              |
| [0012](0012-chunk-boundary-safe-secret-masker.md)               | Chunk-boundary-safe streaming secret masker                                    | Accepted | Domain: logs/security     |
| [0013](0013-in-house-cron-parser-utc-vixie-or.md)               | In-house cron parser, UTC first, Vixie OR semantics                            | Accepted | Domain: scheduling        |
| [0014](0014-set-based-inserts-jsonb-to-recordset.md)            | Set-based inserts via `jsonb_to_recordset`                                     | Accepted | Persistence               |
| [0015](0015-forward-only-sql-migrations-with-checksums.md)      | Forward-only SQL migrations with checksums and an advisory lock                | Accepted | Persistence               |
| [0016](0016-fastify-5-and-zod-at-boundaries.md)                 | Fastify 5 with zod validation at every boundary                                | Accepted | Platform                  |
| [0017](0017-session-cookies-csrf-scrypt.md)                     | Postgres sessions, HttpOnly cookies, CSRF tokens, scrypt                       | Accepted | Security                  |
| [0018](0018-no-docker-native-processes.md)                      | No Docker anywhere: native processes                                           | Accepted | Platform                  |
| [0019](0019-explicit-trust-proxy-configuration.md)              | Explicit `TRUST_PROXY` configuration, never `true`                             | Accepted | Security                  |

Thirteen of the nineteen records (0002-0014) are domain decisions specific to pipeline orchestration.

## Writing a new ADR

1. Copy the structure of an existing record; use the next free number and a kebab-case title.
2. Fill Context and Decision Drivers before Options; list at least three real options, including "do nothing" where it applies.
3. State consequences honestly, including the negative ones and the tickets that mitigate them.
4. Add the record to the index above in the same change as the code it governs.
