# Railyard

[![CI](https://github.com/mayur19/railyard/actions/workflows/ci.yml/badge.svg)](https://github.com/mayur19/railyard/actions/workflows/ci.yml)

**Run your own CI/CD on your own machines: YAML pipelines with a real dependency graph, runners
that lease jobs straight from PostgreSQL, and live build logs in the browser, with no containers
and no hosted services.**

Railyard is a self-hosted pipeline orchestrator for small platform teams and engineering groups
that want to keep builds inside their own network. A pipeline is a YAML file with stages, jobs,
`needs` dependencies, matrices and conditions. Railyard validates it with precise line-level
errors, compiles it into a plan of job instances, and stores the plan in PostgreSQL. Runner
processes claim jobs with `FOR UPDATE SKIP LOCKED`, run shell steps with bash in isolated
workspaces with timeouts, and stream output to the web UI over Server-Sent Events. It needs only
Node.js, PostgreSQL and bash.

> **Project status: early build.** The foundation (config, migrations, auth, RBAC, audit) and
> the core vertical slice are implemented and tested. The slice covers the pipeline validator,
> expression language, matrix and DAG planner, cron parser, run creation, the job-leasing runner
> and live SSE logs, plus a web UI with a run graph and pipeline editor. Everything else is
> designed, documented and tracked in the [backlog](docs/planning/backlog.md): **9.7 %** of the
> estimated effort is complete (200 of 2052 hours, see
> [implementation status](docs/planning/implementation-status.md)). Pending API endpoints answer
> `501 Not Implemented` with their ticket id, and pending screens carry a "Planned" badge.

## Project status

| Area                                                                                                                                                  | Status         | Tickets                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ---------------------------------------- |
| Monorepo, config, logging, migrations, health checks, 501 registry, `run.sh`, seed, CI, Playwright harness                                            | ✅ Implemented | RY-001 to RY-008                         |
| Release packaging (tarball, systemd units, nginx sample)                                                                                              | ⏳ Pending     | RY-009                                   |
| Auth (scrypt, Postgres sessions, CSRF), RBAC, audit log, login throttling (per IP, per-email backoff, per-IP email cap, IPv6 /64), registration limit | ✅ Implemented | RY-020 to RY-023                         |
| Invitations, member management, audit query, password reset, API tokens, sessions, verified signup, shared rate-limit counters                        | ⏳ Pending     | RY-024 to RY-029, RY-150, RY-151         |
| Projects: create, list, get                                                                                                                           | ✅ Implemented | RY-010                                   |
| Project update/delete, git polling of bare repos, branches, `.railyard.yml` loading, checkout, push triggers, path filters                            | ⏳ Pending     | RY-011 to RY-017                         |
| Pipeline YAML validator, expression language, matrix expansion, DAG (cycles, levels, critical path), planner, validate API + editor                   | ✅ Implemented | RY-030 to RY-036                         |
| Definition history, multiple pipelines, templates/includes, matrix-aware needs, JSON Schema export, planner benchmarks                                | ⏳ Pending     | RY-018, RY-019, RY-037 to RY-039, RY-149 |
| Run creation, dependency promotion (`on_success` / `on_failure` / `always`), run status, run list/detail, automatic retries                           | ✅ Implemented | RY-040 to RY-042, RY-045                 |
| Cancel, retry/re-run, retry backoff, run metadata, run timeouts, downstream triggers                                                                  | ⏳ Pending     | RY-043, RY-044, RY-046 to RY-049         |
| Runner: `SKIP LOCKED` leasing, heartbeats, reaper, bash steps in isolated workspaces, timeouts, process-group kill                                    | ✅ Implemented | RY-050 to RY-052                         |
| Runner registration and labels, resource limits, drain, remote runners, workspace quotas, sandboxing, autoscaling                                     | ⏳ Pending     | RY-053 to RY-059                         |
| Logs: sequenced chunks, SSE with `Last-Event-ID` resume, ANSI rendering, streaming secret masker                                                      | ✅ Implemented | RY-060 to RY-063                         |
| Log archival, search/download, fan-out at scale, JUnit reports, collapsible groups                                                                    | ⏳ Pending     | RY-064 to RY-068                         |
| Secrets (AES-256-GCM store, CRUD, injection, key rotation, scopes)                                                                                    | ⏳ Pending     | RY-070 to RY-074                         |
| Artifacts and caches                                                                                                                                  | ⏳ Pending     | RY-080 to RY-086                         |
| Deployment environments, approvals, protection rules, rollback                                                                                        | ⏳ Pending     | RY-090 to RY-093                         |
| Concurrency groups, parallelism limits, fair-share queues, priorities                                                                                 | ⏳ Pending     | RY-095 to RY-098                         |
| In-house cron parser with next-run computation (UTC)                                                                                                  | ✅ Implemented | RY-100                                   |
| Schedule API, scheduler daemon, time zones, pause/resume                                                                                              | ⏳ Pending     | RY-101 to RY-104                         |
| Metrics, dashboard, Prometheus endpoint, flaky job detection, trace export, SLO alerts                                                                | ⏳ Pending     | RY-110 to RY-115                         |
| Web: login, shell with Planned badges, projects, run list, run graph, live log viewer                                                                 | ✅ Implemented | RY-120 to RY-123, RY-125                 |
| Settings screens, accessibility audit, responsive/dark theme, visual pipeline editor                                                                  | ⏳ Pending     | RY-126 to RY-129                         |
| Notifications (in-app, outbox email, status badges, git notes)                                                                                        | ⏳ Pending     | RY-130 to RY-133                         |
| Operations: backup tooling, load test, ASVS review, retention, HA, upgrade playbooks, operator console, CLI, user guide                               | ⏳ Pending     | RY-140 to RY-148                         |

## Quick start

Requirements: Node.js 22+, npm, bash, and a local PostgreSQL 15+ server reachable over the Unix
socket in `/tmp` as your OS user without a password (Homebrew and most Linux packages work out of
the box).

```bash
./run.sh
```

This checks prerequisites, creates `.env` from `.env.example` (random `SESSION_SECRET`, database
URLs for your OS user), installs dependencies, creates the `railyard_dev` and `railyard_test`
databases, applies migrations, seeds demo data and starts three processes:

- Web: http://localhost:5105
- API: http://127.0.0.1:4105 (proxied by the web dev server under `/api`)
- One runner process that picks up queued jobs (start more with `./run.sh runner`)

The seeded Storefront run is queued at startup, so the runner executes it right away: open the
project, click the run and watch the graph and logs update live.

## Demo logins (development only)

These accounts are created by the development seed (`apps/api/src/db/seed.ts`), are public, and
must never exist in a production database. Password for all: `railyard-demo-pass`.

| Email                   | Role      | Organization            |
| ----------------------- | --------- | ----------------------- |
| `owner@railyard.local`  | Owner     | Acme Rail (`acme-rail`) |
| `dev@railyard.local`    | Developer | Acme Rail (`acme-rail`) |
| `viewer@railyard.local` | Viewer    | Acme Rail (`acme-rail`) |

Seeded projects: **Storefront** (`/srv/git/storefront.git`), with one queued run of the
`storefront-ci` pipeline (lint, compile, a 2x2 matrix of unit tests with one exclusion, an
allowed-to-fail smoke job, a `main`-only deploy and an `on_failure` notifier), and **Payments
API** (`/srv/git/payments-api.git`), with one finished run and its logs. Pipelines only run
harmless commands (`echo`, `sleep`, `ls`, `printf`). Repository paths are just stored for now;
git polling is RY-012.

## run.sh commands

| Command                     | Description                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| `./run.sh` / `./run.sh dev` | Setup, then launch API, one runner and web with live reload (`start` is an alias)        |
| `./run.sh setup`            | Check prerequisites, create `.env`, create databases, migrate, seed                      |
| `./run.sh migrate`          | Apply pending database migrations                                                        |
| `./run.sh seed`             | Load demo data (idempotent)                                                              |
| `./run.sh reset [--yes]`    | Drop and recreate the schema, then migrate and seed (refuses when `NODE_ENV=production`) |
| `./run.sh runner`           | Start one additional runner process                                                      |
| `./run.sh test`             | Unit + integration tests against `TEST_DATABASE_URL` (`railyard_test`)                   |
| `./run.sh check`            | Lint, format check, typecheck, tests and build (what CI runs)                            |
| `./run.sh build`            | Production build of API, runner and web                                                  |
| `./run.sh e2e`              | Setup, install Playwright Chromium if possible, run the smoke specs (they need `E2E=1`)  |
| `./run.sh help`             | Show all commands                                                                        |

## Tech stack

| Layer    | Technology                                                                                                                                    |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| API      | Node.js 22, Fastify 5, `@fastify/cookie`, TypeScript (strict), zod, pg, pino; built with tsup                                                 |
| Runner   | Same package as the API: bash child processes in detached process groups, `FOR UPDATE SKIP LOCKED` leasing                                    |
| Web      | React 18, React Router 6, Vite 7, plain CSS with design tokens, SVG run graph, `EventSource` for logs                                         |
| Database | PostgreSQL 15+ (17 used locally), forward-only SQL migrations with checksums, `LISTEN/NOTIFY`                                                 |
| Shared   | `@railyard/shared`: validator, expressions, matrix, DAG, planner, cron, job state machine, ANSI, masker, zod schemas; `yaml` for parsing only |
| Tests    | Vitest, Testing Library (jsdom), Fastify `inject` and real HTTP against real PostgreSQL, Playwright (local only)                              |
| Tooling  | npm workspaces, ESLint, Prettier, GitHub Actions using the runner's preinstalled PostgreSQL                                                   |

## Repository layout

```
railyard/
├── apps/
│   ├── api/                           Fastify API and runner process
│   │   ├── migrations/                0001_foundation.sql, 0002_projects_runs_jobs.sql
│   │   ├── src/
│   │   │   ├── config/ db/ http/ lib/ security/    env, migrations, seed, guards, limiters, errors
│   │   │   ├── modules/
│   │   │   │   ├── auth/ audit/ health/            implemented foundation
│   │   │   │   ├── projects/ pipelines/ runs/ logs/   implemented vertical slice (incl. SSE)
│   │   │   │   └── pending/                        every planned route, answering 501 + ticket
│   │   │   └── runner/                leasing, executor, log writer, workspaces (implemented)
│   │   └── test/                      unit, HTTP, runner and PostgreSQL integration tests
│   └── web/                           React SPA (login, projects, runs, run graph, editor; Planned pages)
├── packages/shared/                   pure domain logic and schemas (heavily unit tested)
├── e2e/                               Playwright config and smoke specs
├── docs/                              product, architecture, ADRs, design, API, security, testing, ops, planning
├── run.sh                             single entry point
└── .env.example                       placeholder configuration
```

## Documentation

Start with the [documentation index](docs/README.md). Key documents:
[PRD](docs/product/PRD.md) ·
[requirements](docs/product/requirements.md) ·
[architecture](docs/architecture/overview.md) ·
[ADRs](docs/adr/README.md) ·
[data model](docs/design/data-model.md) ·
[system design](docs/design/system-design.md) ·
[API](docs/api/README.md) ·
[OpenAPI](docs/api/openapi.yaml) ·
[threat model](docs/security/threat-model.md) ·
[test strategy](docs/testing/test-strategy.md) ·
[runbook](docs/operations/runbook.md) ·
[deployment](docs/operations/deployment.md) ·
[roadmap](docs/planning/roadmap.md) ·
[backlog](docs/planning/backlog.md) ·
[implementation status](docs/planning/implementation-status.md)

## Known limitations

- Runs are started by posting YAML (API or the pipeline editor); git polling, push triggers and
  schedules are pending (RY-012, RY-016, RY-102), even though `on.push` and cron entries are
  already validated.
- Steps run as the runner's OS user with timeouts but no sandbox or resource limits (RY-054,
  RY-058). Run runners under a dedicated unprivileged account.
- `cache`, `artifacts`, `environment` and `concurrency` keys are validated but not executed yet;
  the validator warns about them. `runs-on` labels are stored but not matched (RY-053).
- Login, email fan-out and registration limiters are in memory per process, so run a single API
  instance until shared counters land (RY-151).
- There is no secret store yet (RY-070), so do not put credentials in pipeline YAML.
- Cancel and retry from the UI or API are pending (RY-043, RY-044).
- Playwright smoke specs are not run in CI; locally they need `E2E=1` and a running dev stack.

## Contributing, security and license

- [Contributing guide](CONTRIBUTING.md): setup, workflow, commit conventions, engineering rules.
- [Security policy](SECURITY.md): how to report vulnerabilities and operational safety notes.
- [Changelog](CHANGELOG.md).
- Licensed under the [MIT License](LICENSE).
