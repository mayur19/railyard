# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses semantic versioning.

## [Unreleased]

## [0.1.0] - 2026-11-25

### Added

- Monorepo (npm workspaces): `apps/api` (Fastify 5), `apps/web` (React 18 + Vite), `packages/shared`.
- Pipeline engine in `packages/shared`: YAML loading with line/column mapping, in-house schema
  validator, expression language for `if:` and `${{ }}` interpolation, matrix expansion with
  include/exclude, DAG cycle detection, topological levels, critical path, execution planner with
  implicit stage dependencies and cascade exclusion.
- In-house 5-field cron parser with next-run computation (UTC).
- Job/run state machine and dependency resolution (`on_success`, `on_failure`, `always`,
  `allow-failure`), automatic retries.
- Run creation API persisting plans as jobs and steps; run list and detail endpoints.
- Runner process leasing jobs with `FOR UPDATE SKIP LOCKED`, lease heartbeats, reaper, shell
  steps in isolated workspaces with timeouts and process-group termination.
- Log persistence in sequenced chunks, live streaming over SSE (LISTEN/NOTIFY) with
  `Last-Event-ID` resume, ANSI rendering, streaming secret masker.
- Session authentication (scrypt, HMAC'd session ids, CSRF), RBAC, audit log, login throttling
  (per-IP limit, per-email progressive backoff, per-IP email fan-out cap, IPv6 /64 keys),
  registration rate limit with non-enumerating errors, explicit `TRUST_PROXY`.
- Web UI: login/register, projects, run list, run graph with live logs, pipeline editor with
  inline validation and plan preview; planned sections marked.
- Planned endpoints registered and answering `501 NOT_IMPLEMENTED` with ticket references.
- `run.sh` launcher, seed data, CI on GitHub Actions with the runner's native PostgreSQL.
