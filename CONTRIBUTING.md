# Contributing to Railyard

## Getting started

```bash
./run.sh setup     # prerequisites, .env with random secrets, databases, migrations, demo data
./run.sh dev       # API on :4105, one runner, web on :5105
./run.sh check     # lint, format check, typecheck, tests, build (what CI runs)
```

You need Node.js 22+, npm, bash and a local PostgreSQL 15+ server (socket in `/tmp`, your OS
user, no password). No containers are used anywhere in this project.

## Workflow

1. Pick a ticket from [docs/planning/backlog.md](docs/planning/backlog.md) or a GitHub issue.
2. Write tests first. Domain logic lives in `packages/shared` as pure, immutable functions and
   must stay above the coverage thresholds (85% lines for shared, 80% for the API).
3. Keep files small (< 400 lines) and functions focused. Validate every boundary with zod.
4. New endpoints: add them to `docs/api/openapi.yaml` with `x-status`. Planned endpoints are
   registered in `apps/api/src/modules/pending/pending.routes.ts` and answer 501.
5. Database changes: add a new forward-only file `apps/api/migrations/NNNN_name.sql`; never
   edit an applied migration (checksums are verified at startup).
6. Update docs (`docs/planning/implementation-status.md`, traceability) when a ticket is done.

## Commits

Conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`, `ci:`, `perf:`.
One logical change per commit. Reference ticket IDs in the body (e.g. `Refs: RY-043`).

## Tests in pipelines

Tests that execute pipelines must only run harmless commands (`echo`, `sleep`, `ls`, `printf`)
inside the per-job temporary workspace.
