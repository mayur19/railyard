# ADR-0018: No Docker anywhere: native processes for development, deployment and job execution

- Status: Accepted
- Date: 2026-11-24
- Tickets: RY-005, RY-009, RY-054, RY-058

## Context

Many CI systems assume a container runtime on every runner and ship themselves as container images. Railyard's audience includes operators on locked-down VMs, bare-metal build hosts, macOS build machines and environments where a privileged container daemon is not permitted. A container daemon is also a significant attack surface (root-equivalent socket) and a heavy dependency for a small orchestrator.

## Decision Drivers

- Runs on a plain Linux VM or macOS host with Node 22, bash, git and PostgreSQL.
- No privileged daemon on runner hosts.
- Simple local development (`./run.sh`) against a native Postgres.
- Isolation improvements must use kernel primitives directly.

## Considered Options

1. Containers for packaging (images for API, runner, Postgres) and for job execution.
2. Containers for job execution only.
3. No containers anywhere: native processes managed by systemd, jobs executed as process groups, isolation added through rlimits, cgroups v2 and user namespaces.

## Decision Outcome

Chosen option: **3**. Containers are deliberately not used for development, packaging, deployment, CI of Railyard itself, or job execution.

- Development: `run.sh` checks prerequisites, bootstraps `.env`, creates the database on local Postgres, migrates, seeds, and starts API (4105), runner and web (5105) with `npm run dev`.
- Deployment: release tarball, systemd units for the API and runner, nginx sample config, native Postgres (RY-009).
- Execution: bash in a detached process group with a scratch environment (ADR-0010); resource limits via `systemd-run` scopes and cgroups v2 (RY-054); unprivileged user-namespace sandboxing (RY-058).

### Consequences

- Positive: minimal prerequisites; no daemon socket to protect; works on macOS runners.
- Positive: easier debugging; job processes are ordinary processes visible in `ps`.
- Negative: no per-job image selection; toolchains are installed on hosts and selected with `runs-on` labels (RY-053).
- Negative: weaker default isolation than containers until RY-054 and RY-058 land; mitigated by a dedicated unprivileged runner user and documented in the threat model.
- Negative: operators who prefer containers must package Railyard themselves; this is not supported.
