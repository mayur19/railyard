# ADR-0001: Modular monolith in npm workspaces with a pure shared domain package

- Status: Accepted
- Date: 2026-11-24
- Tickets: RY-001

## Context

Railyard has three runtime roles (browser SPA, API, runner) and a large body of pure logic (pipeline validation, expression evaluation, matrix expansion, DAG algorithms, job state machine, cron, log masking) that at least two of those roles need. The validator must run in the browser for instant editor feedback and on the server as the authority. The completion logic (`completeJob`) must be identical whether the reaper, a runner or (later) a cancel endpoint calls it. The team is small and the product is self-hosted, so operational simplicity outranks independent deployability.

## Decision Drivers

- One definition of pipeline semantics shared by SPA, API and runner.
- Self-hosted operators must deploy few artefacts with no orchestration platform.
- Pure logic must be testable without Postgres (fast property tests).
- Module boundaries must be visible in the file tree and in imports.

## Considered Options

1. Single package, folders by layer (`controllers/`, `services/`, `models/`).
2. Microservices (planner service, scheduler service, log service) communicating over HTTP or a broker.
3. Modular monolith in npm workspaces: `packages/shared` (pure domain), `apps/api` (API + runner entry points), `apps/web` (SPA).
4. Turborepo/Nx monorepo with many fine-grained packages.

## Decision Outcome

Chosen option: **3, modular monolith in npm workspaces**.

- `packages/shared` contains only deterministic, side-effect-free code plus zod schemas. It depends on `yaml` and `zod` only.
- `apps/api` is organised by feature module (`auth`, `projects`, `pipelines`, `runs`, `logs`, `pending`, `audit`, `health`), each owning its tables and repository functions, plus cross-cutting `http/` and the `runner/` entry point which reuses `modules/runs/run-progress.ts` directly.
- `apps/web` imports `@railyard/shared` for the validator, ANSI parser and types.

### Consequences

- Positive: one `npm ci`, one build, two Node entry points (`index.ts`, `runner/cli.ts`); no network hops between planner and persistence; shared code is property-tested in isolation.
- Positive: moving the runner out of process later (RY-056) is a transport change, not a logic change.
- Negative: the API and runner share a release cadence; a runner fix requires redeploying the package.
- Negative: boundaries are enforced by convention and review, not by separate deployables; an import from `modules/runs` into `modules/auth` would compile. Lint rules for import boundaries are a candidate follow-up.
- Option 2 was rejected: distributed transactions would be needed for "complete job and promote dependents" (see ADR-0004), and every extra service is another systemd unit for operators. Option 4 adds tooling with no benefit at three packages.
