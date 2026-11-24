# Implementation status

Railyard is deliberately at the **foundation + first vertical slice** stage. This page states
exactly what works, what is registered but stubbed, and how the percentage is computed.

## How the percentage is computed

`percent done = sum(estimate of tickets with status done) / sum(estimate of all tickets)`, using
the hour estimates in [backlog.md](backlog.md). A ticket only counts as done when its code,
tests and docs are on `main`; partially started work counts as 0.

**Current: 200 h of 2052 h = 9.7%.** 1852 hours of planned work remain.

## By epic

| Epic                         | Done (h) | Total (h) |   % done |
| ---------------------------- | -------: | --------: | -------: |
| E1 Foundation                |       27 |        42 |      64% |
| E2 Identity & Access         |       17 |       127 |      13% |
| E3 Projects & Repositories   |        4 |       138 |       3% |
| E4 Pipeline Definition       |       53 |       170 |      31% |
| E5 Run Orchestration         |       22 |       130 |      17% |
| E6 Runner & Execution        |       22 |       268 |       8% |
| E7 Logs                      |       22 |       139 |      16% |
| E8 Secrets                   |        0 |        84 |       0% |
| E9 Artifacts & Caches        |        0 |       153 |       0% |
| E10 Environments & Approvals |        0 |        84 |       0% |
| E11 Concurrency              |        0 |        99 |       0% |
| E12 Scheduling               |        6 |        81 |       7% |
| E13 Metrics & Observability  |        0 |       123 |       0% |
| E14 Web UI                   |       27 |       135 |      20% |
| E15 Operations               |        0 |       222 |       0% |
| E16 Notifications            |        0 |        57 |       0% |
| **Total**                    |  **200** |  **2052** | **9.7%** |

## By milestone

| Milestone | Done (h) | Total (h) |
| --------- | -------: | --------: |
| M0        |       22 |        22 |
| M1        |      178 |       178 |
| M2        |        0 |       134 |
| M3        |        0 |       225 |
| M4        |        0 |       345 |
| M5        |        0 |       354 |
| M6        |        0 |       218 |
| M7        |        0 |       255 |
| M8        |        0 |       321 |

## What works today (done)

| Area          | What is implemented                                                                                                                                                                                                                                | Where                                                                                   | Tests                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Pipeline YAML | Loading with line/column mapping; strict in-house validator with path-addressed errors and warnings for not-yet-executed keys                                                                                                                      | `packages/shared/src/pipeline/` (`yaml`, `validate`, `validate-job`, `validate-fields`) | `packages/shared/test/validate.test.ts`                        |
| Expressions   | Tokenizer, recursive-descent parser and evaluator for `if:` and `${{ }}`; static reference checking                                                                                                                                                | `packages/shared/src/pipeline/` (`expression`, `interpolate`, `context`)                | `expression.test.ts`, `interpolate.test.ts`                    |
| Matrix        | Cartesian expansion, partial `exclude`, `include` merge/append semantics, limits                                                                                                                                                                   | `packages/shared/src/pipeline/matrix.ts`                                                | `matrix.test.ts`                                               |
| DAG + planner | Iterative cycle detection with path, Kahn levels, critical path, implicit stage needs, cascade exclusion, per-instance conditions, interpolation                                                                                                   | `packages/shared/src/pipeline/` (`dag`, `plan`)                                         | `dag.test.ts` (incl. random-DAG property test), `plan.test.ts` |
| Cron          | 5-field parser, names, steps, macros, Vixie OR semantics, fast next-run search                                                                                                                                                                     | `packages/shared/src/cron/cron.ts`                                                      | `cron.test.ts` (incl. brute-force comparison)                  |
| Job state     | Transition table, dependency resolution (`on_success` / `on_failure` / `always`), run status derivation, retry decision                                                                                                                            | `packages/shared/src/jobs/state.ts`                                                     | `state.test.ts`                                                |
| Logs          | ANSI SGR parser; chunk-boundary-safe secret masker                                                                                                                                                                                                 | `packages/shared/src/logs/`                                                             | `logs.test.ts` (incl. every-chunking property test)            |
| Runs API      | Validate endpoint, run creation (single transaction, set-based inserts), list (cursor), detail                                                                                                                                                     | `apps/api/src/modules/pipelines`, `apps/api/src/modules/runs`                           | `apps/api/test/runs.http.test.ts`                              |
| Runner        | `FOR UPDATE SKIP LOCKED` leasing, heartbeats, reaper, bash steps in isolated workspaces, timeouts, process-group kill, retries, completion that serialises on the run row                                                                          | `apps/api/src/runner/`, `apps/api/src/modules/runs/run-progress.ts`                     | `runner.db.test.ts`, `executor.test.ts`                        |
| Live logs     | Sequenced chunks, NOTIFY, LISTEN hub, SSE with `Last-Event-ID` resume, JSON log paging                                                                                                                                                             | `apps/api/src/modules/logs/`                                                            | `sse.http.test.ts`                                             |
| Auth          | Register/login/logout/me, scrypt, HMAC'd session ids, CSRF, RBAC, audit, login throttling (per-IP limit, per-email backoff reserved before any await, per-IP email cap, IPv6 /64 keys, bounded stores), registration limit, explicit `TRUST_PROXY` | `apps/api/src/modules/auth`, `apps/api/src/http`                                        | `auth.http.test.ts`, `unit.test.ts`                            |
| Foundation    | zod config, pino with redaction, envelope + error handler, request ids, migrations with checksums, health/ready, seed, `run.sh`, CI                                                                                                                | `apps/api/src/config`, `db`, `http`, `lib`; `run.sh`; `.github/workflows/ci.yml`        | `migrate.db.test.ts`, `unit.test.ts`                           |
| Web           | Login/register, shell with Planned badges, projects, run list, run graph, live ANSI log viewer, pipeline editor with plan preview                                                                                                                  | `apps/web/src`                                                                          | `apps/web/test/`                                               |

## What is stubbed (registered, returns 501)

Every planned endpoint in [openapi.yaml](../api/openapi.yaml) with `x-status: pending` is
registered in `apps/api/src/modules/pending/pending.routes.ts`. It authenticates and authorises
like the real route, then answers `501` with `error.code = "NOT_IMPLEMENTED"` and
`error.details.ticket`. Covered areas: project update/delete and git polling (RY-011..RY-014),
cancel/retry/re-run (RY-043, RY-044), raw log download (RY-065), secrets (RY-071), artifacts and
caches (RY-081, RY-084), environments and approvals (RY-090, RY-091), schedules (RY-101), runner
management (RY-053), metrics (RY-110), members and invitations (RY-024, RY-025), audit query
(RY-026), API tokens (RY-028), notifications (RY-130).

Pipeline keys that are **validated but not executed** yet (the validator emits a
`not_yet_executed` warning): `cache` (RY-083), `artifacts` (RY-080), `environment` (RY-090),
`concurrency` (RY-095). `runs-on` labels are stored but not matched (RY-053). `on.push` and
`on.schedule` are validated (the cron expression is fully parsed) but nothing triggers runs
automatically yet (RY-016, RY-102).

The web navigation shows Secrets, Environments, Schedules, Runners, Artifacts, Metrics and
Settings with a "Planned" badge linking to their tickets.

## Known limitations of the implemented slice

- Rate-limit counters are per process; run a single API instance until RY-151.
- Registration still answers synchronously (generic 409 on conflicts); email-verified signup is RY-150.
- Runs are created from YAML posted to the API; reading `.railyard.yml` from the bare repository
  is RY-014.
- Steps run as the runner's OS user without sandboxing (RY-054, RY-058).
- Secret masking is wired into the log writer but there is no secret store yet (RY-070..RY-072).
