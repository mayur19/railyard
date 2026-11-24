# ADR-0010: Shell steps run by bash in a detached process group, with an environment built from scratch and no containers

- Status: Accepted
- Date: 2026-11-24
- Tickets: RY-052, RY-054 (rlimits, cgroups), RY-058 (user namespaces), RY-015 (checkout)

## Context

Each step is a shell script. Steps commonly start background processes, pipelines and subshells (`npm test | tee`, test servers). A timeout or cancellation must terminate the whole tree, not only the direct child. Steps must not see the runner's own secrets (`DATABASE_URL`, `SESSION_SECRET`). Railyard targets self-hosted operators on plain VMs and bare metal and does not require a container runtime.

## Decision Drivers

- Reliable termination of the entire process tree on timeout and cancellation.
- Fail fast on the first failing command, including inside pipelines.
- No inheritance of runner credentials into user code.
- Workspace isolation between jobs and attempts on the same host.
- Zero dependency on a container runtime; an upgrade path to stronger isolation using kernel features directly.

## Considered Options

1. `child_process.exec` with `sh -c`, killing the child PID on timeout.
2. Containers per job (Docker, Podman) with images.
3. `spawn('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], { detached: true, env })`, signalling the negative PID (process group) with SIGTERM then SIGKILL after a grace period; environment built from an allowlist.
4. A per-job systemd transient unit (`systemd-run --scope`).

## Decision Outcome

Chosen option: **3**, implemented in `apps/api/src/runner/executor.ts` and `workspace.ts`.

- `bash --noprofile --norc -eo pipefail -c <script>` so a failing command or pipeline segment fails the step, and no user dotfiles alter behaviour.
- `detached: true` makes the child a process-group leader. On timeout or abort the runner sends `SIGTERM` to `-pid`, then `SIGKILL` to `-pid` after `killGraceMs` (default 3000 ms). The result is `timed_out` or `cancelled` regardless of exit code.
- `buildStepEnv` creates the environment from scratch: `PATH` and `LANG` copied from the runner, `HOME` and `RAILYARD_WORKSPACE` set to the workspace, `TMPDIR` set to `<workspace>/.tmp`, then the planned job env (including `CI`, `RAILYARD_*`, `MATRIX_*`) and step env. Nothing else from `process.env` is passed.
- Workspaces are `WORKSPACE_ROOT/<runId>/<jobId>-a<attempt>`, recreated empty per attempt and removed afterwards unless `RUNNER_KEEP_WORKSPACES=true`. `working-directory` is resolved and refused if it escapes the workspace.
- The job timeout bounds the sum of steps: each step gets `min(step timeout, remaining job time)`; a step cut short by the job deadline is reported as `job timeout`.

### Consequences

- Positive: works on any Linux or macOS host with bash; nothing extra to install.
- Positive: background processes started by steps cannot outlive a timeout, verified by `executor.test.ts` ("kills the whole process group on timeout").
- Positive: runner credentials never reach user code (`unit.test.ts`, "builds an isolated environment without runner secrets").
- Negative: steps run as the runner's OS user and share the host filesystem, network and kernel. A malicious pipeline author with `run:create` can read anything the runner user can read. The deployment guide requires a dedicated unprivileged `railyard-runner` user with no access to the API's env file. Stronger isolation is planned without containers: rlimits and cgroups v2 via `systemd-run` (RY-054), unprivileged user namespaces (RY-058).
- Negative: a process that calls `setsid` escapes the process group; cgroups (RY-054) close this gap.
- Negative: no image-based toolchain selection; tools must be installed on runner hosts, selected by `runs-on` labels (RY-053).
- Rejected: option 1 leaves grandchildren running after timeouts; option 2 contradicts the no-container principle (ADR-0018); option 4 is adopted as an additional layer in RY-054, not as the base mechanism, because it requires systemd on every runner host.
