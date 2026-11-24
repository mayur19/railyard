# Backlog

Every ticket in the Railyard plan. Estimates are engineering hours including tests and docs. Status is `done` or `pending`; `done` tickets are implemented, tested and merged on `main`.

Totals: **124 tickets**, **2052 h** estimated, **200 h done** (9.7%), **1852 h pending**.

Milestones are described in [roadmap.md](roadmap.md). Epics map to the functional requirements in [requirements-traceability.md](../product/requirements-traceability.md).

## E1 Foundation (27/42 h done)

| ID     | Title                                                                    | Milestone | Estimate (h) | Status  | Depends on |
| ------ | ------------------------------------------------------------------------ | --------- | -----------: | ------- | ---------- |
| RY-001 | Monorepo tooling: workspaces, strict TS, ESLint, Prettier, CI workflow   | M0        |            6 | done    | -          |
| RY-002 | Config loader (zod env), pino logging, request IDs, error envelope       | M0        |            5 | done    | RY-001     |
| RY-003 | Forward-only SQL migration runner with checksums                         | M0        |            5 | done    | RY-001     |
| RY-004 | Health and readiness endpoints                                           | M0        |            1 | done    | RY-002     |
| RY-005 | run.sh launcher (prereqs, .env bootstrap, db create, migrate, seed, dev) | M0        |            3 | done    | RY-003     |
| RY-006 | Seed script with demo organization, project and runs                     | M1        |            3 | done    | RY-040     |
| RY-007 | Pending-route registry returning 501 with ticket reference               | M0        |            2 | done    | RY-002     |
| RY-008 | Playwright end-to-end harness and smoke spec                             | M1        |            2 | done    | RY-120     |
| RY-009 | Release packaging: tarball build, systemd units, nginx sample            | M8        |           15 | pending | RY-001     |

## E2 Identity & Access (17/127 h done)

| ID     | Title                                                                                                | Milestone | Estimate (h) | Status  | Depends on |
| ------ | ---------------------------------------------------------------------------------------------------- | --------- | -----------: | ------- | ---------- |
| RY-020 | Register organization owner, login, logout, me; scrypt hashes; Postgres sessions                     | M1        |            8 | done    | RY-003     |
| RY-021 | CSRF token; login throttling (per-IP limit + per-email progressive backoff); registration rate limit | M1        |            4 | done    | RY-020     |
| RY-022 | RBAC roles and permission checks                                                                     | M1        |            3 | done    | RY-020     |
| RY-023 | Audit log write path                                                                                 | M1        |            2 | done    | RY-020     |
| RY-024 | Member invitations via local outbox                                                                  | M6        |           18 | pending | RY-022     |
| RY-025 | Member management and role changes                                                                   | M6        |           12 | pending | RY-024     |
| RY-026 | Audit log query API and UI                                                                           | M6        |           15 | pending | RY-023     |
| RY-027 | Password reset through outbox tokens                                                                 | M6        |           12 | pending | RY-020     |
| RY-028 | Personal API tokens for CLI and automation                                                           | M6        |           15 | pending | RY-022     |
| RY-029 | Session listing and revocation                                                                       | M6        |            8 | pending | RY-020     |
| RY-150 | Email-verified signup through the local outbox (enumeration-safe 202 responses)                      | M6        |           18 | pending | RY-024     |
| RY-151 | Postgres-backed shared rate-limit counters for multi-instance deployments                            | M6        |           12 | pending | RY-021     |

## E3 Projects & Repositories (4/138 h done)

| ID     | Title                                                              | Milestone | Estimate (h) | Status  | Depends on    |
| ------ | ------------------------------------------------------------------ | --------- | -----------: | ------- | ------------- |
| RY-010 | Projects: create, list, get (organization scoped)                  | M1        |            4 | done    | RY-020        |
| RY-011 | Projects: update, archive, delete with cascade rules               | M2        |            8 | pending | RY-010        |
| RY-012 | Git poller for local bare repositories (for-each-ref diffing)      | M2        |           30 | pending | RY-010        |
| RY-013 | Branch and commit browsing API                                     | M2        |           15 | pending | RY-012        |
| RY-014 | Load .railyard.yml from repository at a commit (git show)          | M2        |           18 | pending | RY-012        |
| RY-015 | Workspace checkout into job directory (git worktree / local clone) | M2        |           24 | pending | RY-052        |
| RY-016 | Push trigger matching with branch globs and automatic runs         | M2        |           15 | pending | RY-012,RY-014 |
| RY-017 | Path filters: trigger runs only when matching paths change         | M2        |           24 | pending | RY-016        |

## E4 Pipeline Definition (53/170 h done)

| ID     | Title                                                                     | Milestone | Estimate (h) | Status  | Depends on           |
| ------ | ------------------------------------------------------------------------- | --------- | -----------: | ------- | -------------------- |
| RY-018 | Pipeline definition history and diff view                                 | M3        |           24 | pending | RY-014               |
| RY-019 | Multiple pipelines per project                                            | M3        |           18 | pending | RY-014               |
| RY-030 | YAML loader with line/column mapping                                      | M1        |            4 | done    | RY-001               |
| RY-031 | In-house pipeline schema validator with path-addressed issues             | M1        |           14 | done    | RY-030               |
| RY-032 | Expression language for if conditions and interpolation                   | M1        |            8 | done    | RY-031               |
| RY-033 | Matrix expansion with include/exclude and limits                          | M1        |            6 | done    | RY-031               |
| RY-034 | DAG builder: cycle detection, topological levels, critical path           | M1        |            8 | done    | RY-031               |
| RY-035 | Execution planner: implicit stage needs, cascade exclusion, interpolation | M1        |            8 | done    | RY-032,RY-033,RY-034 |
| RY-036 | Pipeline validate API and editor screen with inline issues                | M1        |            5 | done    | RY-035               |
| RY-037 | Reusable templates: extends, includes, YAML anchors policy                | M3        |           36 | pending | RY-031               |
| RY-038 | Matrix-aware needs (depend on specific instances)                         | M3        |           15 | pending | RY-035               |
| RY-039 | JSON Schema export for editor autocompletion                              | M3        |           12 | pending | RY-031               |
| RY-149 | Planner performance budget and benchmarks (1000-job plans under 50 ms)    | M3        |           12 | pending | RY-035               |

## E5 Run Orchestration (22/130 h done)

| ID     | Title                                                                 | Milestone | Estimate (h) | Status  | Depends on |
| ------ | --------------------------------------------------------------------- | --------- | -----------: | ------- | ---------- |
| RY-040 | Run creation: persist plan as jobs and steps in one transaction       | M1        |            8 | done    | RY-035     |
| RY-041 | Dependency promotion on completion (on_success / on_failure / always) | M1        |            6 | done    | RY-040     |
| RY-042 | Run status derivation, run list and run detail API                    | M1        |            5 | done    | RY-040     |
| RY-043 | Cancel run or job (runner signalling, cascade)                        | M3        |           24 | pending | RY-052     |
| RY-044 | Retry failed job and re-run pipeline                                  | M3        |           18 | pending | RY-041     |
| RY-045 | Automatic retries (immediate requeue up to retries)                   | M1        |            3 | done    | RY-052     |
| RY-046 | Retry backoff and retryable exit codes                                | M3        |            9 | pending | RY-045     |
| RY-047 | Run metadata: commit message, author, trigger actor                   | M3        |            9 | pending | RY-014     |
| RY-048 | Run-level timeouts and global queue limits                            | M3        |           12 | pending | RY-042     |
| RY-049 | Downstream pipeline triggers across projects                          | M3        |           36 | pending | RY-041     |

## E6 Runner & Execution (22/268 h done)

| ID     | Title                                                                            | Milestone | Estimate (h) | Status  | Depends on |
| ------ | -------------------------------------------------------------------------------- | --------- | -----------: | ------- | ---------- |
| RY-050 | Job leasing with FOR UPDATE SKIP LOCKED                                          | M1        |            6 | done    | RY-040     |
| RY-051 | Lease heartbeats and reaper for expired leases                                   | M1        |            6 | done    | RY-050     |
| RY-052 | Shell step execution in isolated workspaces with timeouts and process-group kill | M1        |           10 | done    | RY-050     |
| RY-053 | Runner registration tokens and runs-on label matching                            | M4        |           30 | pending | RY-050     |
| RY-054 | Resource limits (rlimits, cgroups v2 via systemd-run)                            | M4        |           36 | pending | RY-052     |
| RY-055 | Graceful runner shutdown and drain                                               | M4        |           12 | pending | RY-051     |
| RY-056 | Remote runners over HTTPS long-polling (no direct DB access)                     | M4        |           60 | pending | RY-053     |
| RY-057 | Workspace cleanup and disk quotas                                                | M4        |           12 | pending | RY-052     |
| RY-058 | Unprivileged sandboxing with user namespaces (no containers)                     | M4        |           60 | pending | RY-054     |
| RY-059 | Local runner process pool autoscaling                                            | M4        |           36 | pending | RY-053     |

## E7 Logs (22/139 h done)

| ID     | Title                                                                  | Milestone | Estimate (h) | Status  | Depends on |
| ------ | ---------------------------------------------------------------------- | --------- | -----------: | ------- | ---------- |
| RY-060 | Log persistence in sequenced chunks                                    | M1        |            5 | done    | RY-052     |
| RY-061 | SSE live log streaming via LISTEN/NOTIFY with Last-Event-ID resume     | M1        |            8 | done    | RY-060     |
| RY-062 | ANSI rendering in the log viewer                                       | M1        |            5 | done    | RY-061     |
| RY-063 | Streaming secret masker (chunk-boundary safe)                          | M1        |            4 | done    | RY-060     |
| RY-064 | Log archival to compressed files and retention                         | M5        |           24 | pending | RY-060     |
| RY-065 | Log search and raw download                                            | M5        |           15 | pending | RY-064     |
| RY-066 | Log fan-out at scale: shared LISTEN connection, backpressure, batching | M5        |           24 | pending | RY-061     |
| RY-067 | JUnit XML test report parsing and annotations                          | M5        |           36 | pending | RY-080     |
| RY-068 | Collapsible log groups and step annotations                            | M5        |           18 | pending | RY-062     |

## E8 Secrets (0/84 h done)

| ID     | Title                                                                 | Milestone | Estimate (h) | Status  | Depends on    |
| ------ | --------------------------------------------------------------------- | --------- | -----------: | ------- | ------------- |
| RY-070 | AES-256-GCM secret store with key versioning                          | M5        |           24 | pending | RY-022        |
| RY-071 | Secret CRUD API and UI (write-only values)                            | M5        |           15 | pending | RY-070        |
| RY-072 | Secret injection into job environment with log masking                | M5        |           12 | pending | RY-070,RY-063 |
| RY-073 | Master key rotation tooling                                           | M5        |           15 | pending | RY-070        |
| RY-074 | Secret scopes (organization / project / environment) and access audit | M5        |           18 | pending | RY-071        |

## E9 Artifacts & Caches (0/153 h done)

| ID     | Title                                                  | Milestone | Estimate (h) | Status  | Depends on |
| ------ | ------------------------------------------------------ | --------- | -----------: | ------- | ---------- |
| RY-080 | Artifact upload from workspace to local artifact store | M5        |           30 | pending | RY-052     |
| RY-081 | Artifact browse and download API and UI                | M5        |           15 | pending | RY-080     |
| RY-082 | Artifact retention and expiry sweeper                  | M5        |           12 | pending | RY-080     |
| RY-083 | Cache save/restore keyed by interpolated templates     | M5        |           30 | pending | RY-052     |
| RY-084 | Cache eviction (LRU, per-project quota)                | M5        |           12 | pending | RY-083     |
| RY-085 | Artifact passing between dependent jobs                | M5        |           24 | pending | RY-080     |
| RY-086 | Content-addressed artifact storage with deduplication  | M5        |           30 | pending | RY-080     |

## E10 Environments & Approvals (0/84 h done)

| ID     | Title                                              | Milestone | Estimate (h) | Status  | Depends on |
| ------ | -------------------------------------------------- | --------- | -----------: | ------- | ---------- |
| RY-090 | Deployment environments and deployment history     | M6        |           24 | pending | RY-041     |
| RY-091 | Manual approval gates with required reviewers      | M6        |           30 | pending | RY-090     |
| RY-092 | Environment protection rules (branch restrictions) | M6        |           12 | pending | RY-090     |
| RY-093 | Deployment rollback action                         | M6        |           18 | pending | RY-090     |

## E11 Concurrency (0/99 h done)

| ID     | Title                                                   | Milestone | Estimate (h) | Status  | Depends on |
| ------ | ------------------------------------------------------- | --------- | -----------: | ------- | ---------- |
| RY-095 | Concurrency groups (queue or cancel-in-progress)        | M4        |           24 | pending | RY-050     |
| RY-096 | Per-project parallelism limits and matrix max-parallel  | M4        |           15 | pending | RY-050     |
| RY-097 | Fair-share scheduling across projects (weighted queues) | M4        |           36 | pending | RY-050     |
| RY-098 | Job priorities and preemption of low-priority work      | M4        |           24 | pending | RY-097     |

## E12 Scheduling (6/81 h done)

| ID     | Title                                                                     | Milestone | Estimate (h) | Status  | Depends on |
| ------ | ------------------------------------------------------------------------- | --------- | -----------: | ------- | ---------- |
| RY-100 | In-house cron parser with next-run computation (UTC)                      | M1        |            6 | done    | RY-001     |
| RY-101 | Schedule CRUD API                                                         | M7        |           12 | pending | RY-100     |
| RY-102 | Scheduler daemon with advisory-lock leader election and missed-run policy | M7        |           30 | pending | RY-101     |
| RY-103 | IANA time zone support for schedules (DST-safe)                           | M7        |           24 | pending | RY-102     |
| RY-104 | Schedule pause/resume and trigger history                                 | M7        |            9 | pending | RY-102     |

## E13 Metrics & Observability (0/123 h done)

| ID     | Title                                                       | Milestone | Estimate (h) | Status  | Depends on    |
| ------ | ----------------------------------------------------------- | --------- | -----------: | ------- | ------------- |
| RY-110 | Queue time and duration percentile metrics API              | M7        |           24 | pending | RY-042        |
| RY-111 | Metrics dashboard UI with SVG charts                        | M7        |           24 | pending | RY-110        |
| RY-112 | Prometheus text-format /metrics endpoint                    | M7        |            9 | pending | RY-110        |
| RY-113 | Flaky job detection from retry history                      | M7        |           24 | pending | RY-110        |
| RY-114 | Trace export (OTLP-compatible JSON files) for run timelines | M7        |           24 | pending | RY-110        |
| RY-115 | Queue-time SLO alerts (in-app)                              | M7        |           18 | pending | RY-110,RY-130 |

## E14 Web UI (27/135 h done)

| ID     | Title                                                    | Milestone | Estimate (h) | Status  | Depends on    |
| ------ | -------------------------------------------------------- | --------- | -----------: | ------- | ------------- |
| RY-120 | Web shell: login, layout, navigation with Planned badges | M1        |            6 | done    | RY-020        |
| RY-121 | Projects screen (list and create)                        | M1        |            4 | done    | RY-010        |
| RY-122 | Run graph view (DAG columns by level, SVG edges)         | M1        |            8 | done    | RY-042        |
| RY-123 | Live log viewer with ANSI colours over SSE               | M1        |            6 | done    | RY-061,RY-062 |
| RY-125 | Run list per project                                     | M1        |            3 | done    | RY-042        |
| RY-126 | Settings screens: organization, members, tokens          | M6        |           24 | pending | RY-025,RY-028 |
| RY-127 | Accessibility audit and keyboard navigation              | M8        |           15 | pending | RY-120        |
| RY-128 | Responsive layout and dark theme                         | M8        |            9 | pending | RY-120        |
| RY-129 | Visual pipeline editor (graph-based authoring)           | M8        |           60 | pending | RY-036        |

## E15 Operations (0/222 h done)

| ID     | Title                                                            | Milestone | Estimate (h) | Status  | Depends on |
| ------ | ---------------------------------------------------------------- | --------- | -----------: | ------- | ---------- |
| RY-140 | Backup and restore tooling                                       | M8        |            9 | pending | RY-003     |
| RY-141 | Load test: 10k queued jobs, 50 runners                           | M8        |           24 | pending | RY-056     |
| RY-142 | Security hardening review against ASVS L2                        | M8        |           24 | pending | RY-070     |
| RY-143 | Data retention jobs for runs and logs                            | M8        |           15 | pending | RY-064     |
| RY-144 | High availability: multiple API nodes and LISTEN/NOTIFY failover | M8        |           36 | pending | RY-066     |
| RY-145 | Upgrade and migration rollback playbooks                         | M8        |           12 | pending | RY-009     |
| RY-146 | Multi-organization operator console                              | M8        |           30 | pending | RY-025     |
| RY-147 | Command-line client (validate, run, logs)                        | M8        |           48 | pending | RY-028     |
| RY-148 | User guide and tutorials                                         | M8        |           24 | pending | -          |

## E16 Notifications (0/57 h done)

| ID     | Title                                                        | Milestone | Estimate (h) | Status  | Depends on |
| ------ | ------------------------------------------------------------ | --------- | -----------: | ------- | ---------- |
| RY-130 | In-app notifications for run failures                        | M7        |           18 | pending | RY-041     |
| RY-131 | Outbox email notifications (file sink, no external provider) | M7        |           15 | pending | RY-130     |
| RY-132 | SVG status badges per project and branch                     | M7        |            9 | pending | RY-042     |
| RY-133 | Commit status write-back as git notes in the bare repository | M7        |           15 | pending | RY-012     |
