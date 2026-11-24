# User Stories

Stories grouped by the epics of the [backlog](../planning/backlog.md). Each story names its persona (see [PRD](PRD.md#3-personas)), the tickets that deliver it, the functional requirements it satisfies, and Given/When/Then acceptance criteria. Status mirrors the tickets: **done** when all listed tickets are done.

Personas: **PE** platform engineer, **DEV** application developer, **RM** release manager, **SEC** security/compliance reviewer, **OWN** small-team owner.

---

## E1 Foundation

### US-1.1 Boot a working installation with one command (OWN) — done

Tickets: RY-001, RY-002, RY-003, RY-004, RY-005 · FR-104, NFR-002, NFR-004, NFR-005

- **Given** a Linux host with Node.js 22 and a native PostgreSQL server reachable over the local socket
- **When** I run `./run.sh setup`
- **Then** prerequisites are checked, `.env` is written with random `SESSION_SECRET`, the database is created if missing, migrations are applied in order with checksums recorded, demo data is seeded, and `GET http://localhost:4105/api/health` returns `{"data":{"status":"ok",...}}`

### US-1.2 Know which parts of the API are not built yet (DEV) — done

Tickets: RY-007 · FR-105

- **Given** I am logged in as a developer
- **When** I call `POST /api/runs/:id/cancel`
- **Then** I receive `501` with `error.code = "NOT_IMPLEMENTED"` and `error.details.ticket = "RY-043"`
- **And given** I am not logged in, **when** I call the same route, **then** I receive `401` (pending routes are guarded like real ones)

### US-1.3 Explore Railyard with realistic demo data (OWN) — done

Tickets: RY-006 · FR-106

- **Given** a freshly migrated database
- **When** I run `./run.sh seed`
- **Then** a demo organization, owner account, project and several runs from bundled pipelines exist, and running seed again does not duplicate them

### US-1.4 Catch UI regressions with a browser smoke test (DEV) — done

Tickets: RY-008 · NFR-017

- **Given** the API on port 4105 and the web app on port 5105 with seeded data
- **When** I run `npm run test:e2e`
- **Then** Playwright signs in as the demo owner and opens a run of the demo project; where browsers are unavailable (for example in CI) the spec may be skipped, and the README documents how to run it locally

### US-1.5 Diagnose a failing request from its id (PE) — done

Tickets: RY-002, RY-004 · NFR-002, NFR-003, FR-104

- **Given** a request that fails with a server error
- **When** I read the response
- **Then** it carries an `x-request-id` header and an enveloped `error.code`, and the same id appears in the structured pino log line, which contains no passwords, session tokens or secret values
- **Given** `SESSION_SECRET` is shorter than 32 characters, **when** the API starts, **then** it exits listing every invalid setting
- **Given** the database is stopped, **when** a load balancer calls `GET /api/ready`, **then** it receives `503` while `GET /api/health` still answers

### US-1.6 Install from a release tarball with systemd (PE) — pending

Tickets: RY-009 · NFR-026

- **Given** a release tarball and a VM with Node.js and PostgreSQL
- **When** I unpack it and enable the shipped systemd units for API and runner behind the sample nginx site
- **Then** the services start on boot, restart on failure, and no container runtime is required

---

## E2 Identity & Access

### US-2.1 Register my organization (OWN) — done

Tickets: RY-020, RY-021 · FR-001, FR-005

- **Given** no account exists for `lee@example.test`
- **When** I submit the Register form with a 12+ character password and organization slug `acme`
- **Then** I am signed in as `owner` of organization `acme` and an `auth.registered` audit entry exists
- **Given** the email or the slug is already taken
- **When** I register again
- **Then** I see the same message "Registration could not be completed with the supplied details" in both cases
- **Given** 5 registrations from my IP in the last hour
- **When** I try a sixth
- **Then** I receive `429` with `Retry-After`

### US-2.2 Sign in safely (DEV) — done

Tickets: RY-020, RY-021 · FR-002, FR-003, FR-004

- **Given** a valid account
- **When** I log in
- **Then** an HttpOnly session cookie is set and `GET /api/auth/me` returns my role and CSRF token
- **Given** I am signed in
- **When** a script posts to `/api/projects` without the `x-csrf-token` header
- **Then** the request is rejected with `403`
- **Given** an attacker has failed 5 times for my email from several IPs
- **When** they try again
- **Then** they are locked out for 30 s, doubling per further failure up to 1 hour, and my next successful login clears the counter
- **Given** one IP (or one IPv6 /64) has already tried 20 distinct emails in the window
- **When** it tries a new email
- **Then** the attempt is refused with `429`, while an email it already tried can still be retried under the normal limits

### US-2.3 Restrict what viewers can do (SEC) — done

Tickets: RY-022 · FR-006

- **Given** a member with role `viewer`
- **When** they call `POST /api/projects`
- **Then** they receive `403` and nothing is created
- **And** `developer` can create and cancel runs but cannot write secrets or manage runners

### US-2.4 Invite teammates (OWN) — pending

Tickets: RY-024, RY-025 · FR-008, FR-009

- **Given** I am an owner
- **When** I invite `marco@example.test` as `developer`
- **Then** an invitation message is written to the local outbox with a single-use link
- **When** Marco accepts it before expiry
- **Then** he becomes a `developer` member; reusing the link fails
- **Given** I am the only owner, **when** I try to demote myself, **then** the change is refused

### US-2.5 Record security-relevant actions (SEC) — done

Tickets: RY-023 · FR-007

- **Given** a user logs in, fails a login, creates a project or starts a run
- **When** the action completes
- **Then** an `audit_logs` row exists with action (`auth.login`, `auth.login_failed`, `project.created`, `run.created`), actor, organization, target, request id and IP; for run creation it is committed in the same transaction as the run

### US-2.6 Review who did what (SEC) — pending

Tickets: RY-026 · FR-010

- **Given** audit entries for logins and run creations
- **When** I query `GET /api/audit-logs?action=run.created&from=...`
- **Then** I receive matching entries newest first with a cursor, and users without `audit:read` receive `403`

### US-2.7 Automate with personal API tokens (DEV) — pending

Tickets: RY-028, RY-029 · FR-012, FR-013

- **Given** I am signed in
- **When** I create a token with `run:create` and 30-day expiry
- **Then** the token is shown once, only its hash is stored, and requests bearing it can create runs without a CSRF header
- **When** I revoke one of my browser sessions
- **Then** that browser is signed out on its next request

### US-2.8 Recover access and verify email (OWN) — pending

Tickets: RY-027, RY-150 · FR-011, FR-014

- **Given** I forgot my password
- **When** I request a reset
- **Then** the response is `202` whether or not the email exists, and a 1-hour single-use link is written to the outbox
- **Given** I sign up
- **When** the response returns
- **Then** it is always `202`, and I cannot log in until I follow the verification link

### US-2.9 Run two API nodes without weakening throttling (PE) — pending

Tickets: RY-151 · NFR-019

- **Given** two API processes behind nginx
- **When** an attacker alternates login attempts between them
- **Then** the per-email backoff and per-IP limits apply as if there were one process, because counters live in Postgres

---

## E3 Projects & Repositories

### US-3.1 Create a project for a local repository (DEV) — done

Tickets: RY-010 · FR-015

- **Given** a bare repository at `/srv/git/storefront.git`
- **When** I create project "Storefront" with slug `storefront` and that absolute path
- **Then** it appears in my organization's project list
- **Given** a relative path such as `git/storefront.git`, **when** I submit, **then** I see a validation error
- **Given** another organization, **when** they request my project by id, **then** they receive `404`

### US-3.2 Start runs automatically on push (DEV) — pending

Tickets: RY-012, RY-014, RY-016 · FR-017, FR-019, FR-021

- **Given** a project whose `.railyard.yml` declares `on: { push: { branches: ["main", "release/*"] } }`
- **When** I push a commit to `release/2.3` in the bare repository
- **Then** within one poll interval a run with event `push`, branch `release/2.3` and the new SHA is created from the YAML at that commit
- **When** I push to `feature/x`
- **Then** no run is created

### US-3.3 Skip runs for irrelevant changes (DEV) — pending

Tickets: RY-017 · FR-022

- **Given** `paths-ignore: ["docs/**"]`
- **When** a push changes only `docs/intro.md`
- **Then** no run is created; a push touching `src/` creates one

### US-3.4 Build the exact commit in the workspace (DEV) — pending

Tickets: RY-015 · FR-020

- **Given** a run for SHA `9f1c2ab`
- **When** a job starts
- **Then** its workspace contains the tree of `9f1c2ab`, and a missing commit fails the job with a system log line explaining why

### US-3.5 Browse branches and commits (RM) — pending

Tickets: RY-013, RY-011 · FR-018, FR-016

- **Given** a polled project
- **When** I open its branches
- **Then** I see each ref with head commit, author and message, and can archive the project when it is retired

---

## E4 Pipeline Definition

### US-4.1 Get precise errors for a broken pipeline (DEV) — done

Tickets: RY-030, RY-031, RY-036 · FR-023, FR-024, FR-030

- **Given** YAML where job `deploy` needs `biuld` and job `a` needs `b` which needs `a`
- **When** I click Validate in the Pipeline editor
- **Then** I see `unknown_job` at `jobs.deploy.needs[0]` and `cycle` with path `a -> b -> a`, each with line and column, all in one response
- **Given** a file larger than 256 KiB, **when** I validate, **then** it is rejected before parsing

### US-4.2 Express conditions and interpolation (DEV) — done

Tickets: RY-032 · FR-025, FR-026

- **Given** `if: branch == 'main' && !startsWith(event, 'sched')`
- **When** I preview the plan for branch `main` and event `push`
- **Then** the job is included; for branch `dev` it appears under `excluded` with a reason
- **Given** `run: echo ${{ matrix.node }}`, **when** the plan is computed, **then** each instance's script contains its own value

### US-4.3 Fan out a matrix (DEV) — done

Tickets: RY-033 · FR-027

- **Given** axes `os: [linux, mac]`, `node: [20, 22]`, `exclude: [{os: mac, node: 20}]`, `include: [{os: linux, node: 22, coverage: true}]`
- **When** the plan is computed
- **Then** 3 instances exist with stable keys, and the `linux/22` instance carries `coverage: true`
- **Given** a matrix that would expand to 300 combinations, **when** I validate, **then** I get `too_many` at the matrix path

### US-4.4 See parallelism and the critical path before running (DEV) — done

Tickets: RY-034, RY-035, RY-036 · FR-028, FR-029, FR-030

- **Given** stages `build, test, deploy` with explicit `needs` on some jobs
- **When** I preview the plan
- **Then** jobs without `needs` depend on every job of the previous non-empty stage, `needs: []` jobs sit at level 0, levels and the critical path are listed, and repeating the preview returns an identical plan

### US-4.5 Be warned about keys that do not execute yet (DEV) — done

Tickets: RY-031, RY-036 · FR-030

- **Given** a job with `cache:` and `environment: production`
- **When** I validate
- **Then** the result is valid with `not_yet_executed` warnings naming RY-083 and RY-090

### US-4.6 Reuse job definitions (PE) — pending

Tickets: RY-037, RY-038 · FR-033, FR-034

- **Given** a `.node-job` template and `extends: .node-job` on three jobs
- **When** I validate
- **Then** each job contains the merged keys, and `needs: [{ job: build, matrix: { os: linux } }]` depends only on the linux build instance

### US-4.7 Manage several pipelines and their history (DEV) — pending

Tickets: RY-018, RY-019, RY-039, RY-149 · FR-031, FR-032, FR-035, NFR-018

- **Given** `.railyard/ci.yml` and `.railyard/nightly.yml`
- **When** commits change them
- **Then** each pipeline has its own runs, I can diff two versions of a definition, my editor autocompletes from the exported JSON Schema, and a 1000-job plan compiles in under 50 ms

---

## E5 Run Orchestration

### US-5.1 Start a run and see its jobs immediately (DEV) — done

Tickets: RY-040, RY-042 · FR-036, FR-038

- **Given** a valid pipeline
- **When** I start a run
- **Then** it receives the next run number, jobs without dependencies are `queued` and the rest `blocked`, and the run appears at the top of the Runs list
- **Given** two runs started at the same instant, **then** they get distinct consecutive numbers
- **Given** YAML whose jobs are all excluded for this branch, **then** I receive `422 EMPTY_PLAN`

### US-5.2 Have dependents follow failure semantics (DEV) — done

Tickets: RY-041 · FR-037

- **Given** `test` fails, `deploy` needs `test` with `when: on_success`, `notify` needs `deploy` with `when: on_failure`, and `cleanup` needs `deploy` with `when: always`
- **When** `test` settles as failed
- **Then** `deploy` is skipped, `notify` is queued because an ancestor failed, and `cleanup` is queued
- **Given** `lint` has `allow-failure: true` and fails, **then** its `on_success` dependents still run and the run can succeed

### US-5.3 Ride out transient failures (DEV) — done

Tickets: RY-045 · FR-039

- **Given** a job with `retries: 2` whose first attempt fails
- **When** the attempt completes
- **Then** the job returns to `queued`, attempt 2 runs, and its log continues the same sequence after attempt 1's lines

### US-5.4 Stop a run I no longer need (RM) — pending

Tickets: RY-043 · FR-040

- **Given** a run with one running and three blocked jobs
- **When** I cancel the run
- **Then** the running job's process group receives SIGTERM then SIGKILL, blocked jobs become cancelled, and the run status becomes cancelled

### US-5.5 Retry or re-run (DEV) — pending

Tickets: RY-044, RY-046 · FR-041, FR-042

- **Given** a failed job
- **When** I click Retry
- **Then** a new attempt starts and its previously skipped dependents return to blocked
- **Given** `retry: { max: 3, backoff: 10s, exit-codes: [75] }`, **when** the step exits 75, **then** it is retried after 10 s, 20 s, 40 s; exit code 1 is not retried

### US-5.6 Understand why a run happened (RM) — pending

Tickets: RY-047, RY-048, RY-049 · FR-043, FR-044, FR-045

- **Given** a push-triggered run
- **When** I open it
- **Then** I see commit message, author and triggering actor; a run exceeding its run-level timeout is cancelled; a `trigger:` job starts the downstream project's run and mirrors its status when `wait` is set

---

## E6 Runner & Execution

### US-6.1 Scale runners without coordination services (PE) — done

Tickets: RY-050 · FR-046, NFR-008

- **Given** 10 queued jobs and 4 runner processes polling concurrently
- **When** they lease
- **Then** each job is claimed by exactly one runner, none blocks waiting on another's row lock, and the oldest queued job is served first

### US-6.2 Recover from a crashed build host (RM) — done

Tickets: RY-051 · FR-047, NFR-009

- **Given** a runner dies while holding a 30 s lease
- **When** the lease expires
- **Then** within the next 10 s reaper pass the attempt is settled as failed with reason "lease expired (runner lost)" and requeued if retries remain
- **Given** a partitioned runner comes back, **when** its heartbeat finds the lease gone, **then** it stops the job and its late result is discarded

### US-6.3 Contain runaway steps (PE) — done

Tickets: RY-052 · FR-048, NFR-013

- **Given** a step `sleep 1000 & sleep 1000` with a 1-minute timeout
- **When** the timeout fires
- **Then** the whole process group is terminated (SIGTERM, then SIGKILL after the grace period), the step is `timed_out`, and no orphan remains
- **Given** `working-directory: ../../etc`, **then** the step fails before running
- **Given** the runner has `DATABASE_URL` set, **when** a step runs `env`, **then** it is absent

### US-6.4 Route jobs to capable runners (PE) — pending

Tickets: RY-053, RY-056 · FR-049, FR-052

- **Given** a runner registered with a one-time token and labels `linux, arm64`
- **When** a job has `runs-on: [arm64]`
- **Then** only runners carrying `arm64` lease it; a remote runner does so over HTTPS long-polling without database credentials

### US-6.5 Enforce resource limits and sandboxing (SEC) — pending

Tickets: RY-054, RY-058 · FR-050, FR-054, NFR-028

- **Given** a memory limit of 2 GiB per step
- **When** a step allocates 3 GiB
- **Then** it is killed and fails with reason "memory limit exceeded"; with sandboxing enabled the step cannot write outside its workspace

### US-6.6 Keep disks healthy and drain cleanly (PE) — pending

Tickets: RY-055, RY-057, RY-059 · FR-051, FR-053, FR-055, NFR-029

- **Given** free space below the configured floor
- **When** a runner polls
- **Then** it refuses new leases; on SIGTERM it stops leasing and finishes current jobs within the drain timeout; the local pool grows with queue depth up to its maximum

---

## E7 Logs

### US-7.1 Watch logs live and in colour (DEV) — done

Tickets: RY-060, RY-061, RY-062, RY-123 · FR-056, FR-057, FR-058, FR-098

- **Given** a running job printing coloured test output
- **When** I select it on the Run page
- **Then** lines appear within about a second with ANSI colours rendered, stderr and system lines distinguished
- **Given** my connection drops after seq 120, **when** the browser reconnects with `Last-Event-ID: 120`, **then** streaming resumes at seq 121 with no duplicates, and an `end` event closes the stream when the job finishes

### US-7.2 Never see a secret in logs (SEC) — done

Tickets: RY-063 · FR-059

- **Given** a secret value `s3cr3t-token`
- **When** a step prints it split across two output chunks (`s3cr3` then `t-token`)
- **Then** the stored and streamed log shows `***`, and text that cannot be part of a secret is released at the next chunk or flush

### US-7.3 Survive runaway output (PE) — done

Tickets: RY-060 · NFR-012

- **Given** a step that prints endlessly
- **When** 5 MiB have been stored for the attempt
- **Then** a single "[railyard] log truncated after 5242880 bytes" notice is stored and further output is dropped, while the step keeps its timeout

### US-7.4 Keep logs affordable and searchable (PE) — pending

Tickets: RY-064, RY-065, RY-066 · FR-060, FR-061, NFR-020

- **Given** jobs finished more than 7 days ago
- **When** archival runs
- **Then** their chunks move to gzip files, the viewer still loads them, search finds lines by text, and raw download returns plain text
- **Given** 500 viewers on one API node, **then** a slow client is disconnected rather than buffering unbounded data

### US-7.5 Read test results, not just logs (DEV) — pending

Tickets: RY-067, RY-068 · FR-062, FR-063

- **Given** a job declaring `reports: junit: reports/*.xml`
- **When** it completes
- **Then** run detail shows passed/failed counts and annotations per failing test; `::group::` sections are collapsible

---

## E8 Secrets

### US-8.1 Store secrets encrypted (SEC) — pending

Tickets: RY-070, RY-071, RY-073 · FR-064, FR-065, FR-067

- **Given** I have `secret:write`
- **When** I `PUT /api/projects/:id/secrets/NPM_TOKEN`
- **Then** the value is stored as AES-256-GCM ciphertext with a key version, the list endpoint shows only the name and timestamps, and no endpoint returns the value
- **When** an operator rotates the master key, **then** all values are re-encrypted and remain usable during rotation

### US-8.2 Use secrets in jobs safely (DEV) — pending

Tickets: RY-072, RY-074 · FR-066, FR-068

- **Given** project secret `NPM_TOKEN` and organization secret of the same name
- **When** a job references `NPM_TOKEN`
- **Then** the project value is injected as an environment variable, registered with the log masker, and an access audit entry is written

---

## E9 Artifacts & Caches

### US-9.1 Keep build outputs (DEV) — pending

Tickets: RY-080, RY-081, RY-082 · FR-069, FR-070, FR-071

- **Given** `artifacts: { paths: [dist/], expire-in: 7d }`
- **When** the job succeeds
- **Then** the files are stored on local disk with checksum, listed under the run, downloadable, and removed by the sweeper after 7 days

### US-9.2 Pass outputs between jobs (DEV) — pending

Tickets: RY-085, RY-086 · FR-074, FR-075

- **Given** `deploy` needs `build` which produced artifacts
- **When** `deploy` starts
- **Then** the artifacts are extracted into its workspace; identical files across runs are stored once

### US-9.3 Speed up builds with caches (DEV) — pending

Tickets: RY-083, RY-084 · FR-072, FR-073

- **Given** `cache: { key: "npm-${{ hashFiles('package-lock.json') }}", paths: [~/.npm] }`
- **When** a second run uses the same lockfile
- **Then** the cache is restored before the first step; when the project exceeds its quota, least recently used entries are evicted

---

## E10 Environments & Approvals

### US-10.1 Track deployments per environment (RM) — pending

Tickets: RY-090 · FR-076

- **Given** a job with `environment: production`
- **When** it succeeds
- **Then** a deployment record (commit, run, actor, time) appears in production's history

### US-10.2 Gate production behind approval (RM) — pending

Tickets: RY-091, RY-092 · FR-077, FR-078

- **Given** production requires one reviewer from the release group and allows only `main`
- **When** a run reaches the deploy job from `main`
- **Then** the job waits until a reviewer other than the requester approves; rejection skips it; a job from `feature/x` is refused before execution

### US-10.3 Roll back quickly (RM) — pending

Tickets: RY-093 · FR-079

- **Given** a faulty deployment
- **When** I choose the previous successful deployment and click Roll back
- **Then** its deploy job re-runs for that commit and the history marks it as a rollback

---

## E11 Concurrency

### US-11.1 Serialise deployments (RM) — pending

Tickets: RY-095 · FR-080

- **Given** `concurrency: { group: deploy-production, mode: cancel-in-progress }`
- **When** a newer run reaches the deploy job while an older one is deploying
- **Then** the older member is cancelled; with mode `queue` the newer one waits

### US-11.2 Share runners fairly (PE) — pending

Tickets: RY-096, RY-097, RY-098 · FR-081, FR-082, FR-083

- **Given** project A enqueues 500 matrix jobs and project B enqueues 5
- **When** runners lease
- **Then** B's jobs start within one lease cycle instead of waiting behind A, A's matrix respects `max-parallel`, and a high-priority hotfix job can preempt low-priority work

---

## E12 Scheduling

### US-12.1 Trust cron expressions (DEV) — done

Tickets: RY-100 · FR-084

- **Given** `on: { schedule: [{ cron: "0 3 * * MON-FRI" }] }`
- **When** I validate
- **Then** it is accepted; `0 0 30 2 *` is accepted but has no next run, and `61 * * * *` is rejected with `invalid_cron`

### US-12.2 Run nightly builds (PE) — pending

Tickets: RY-101, RY-102, RY-104 · FR-085, FR-086, FR-088

- **Given** a schedule `0 2 * * *` on `main`
- **When** two scheduler processes are running
- **Then** only the advisory-lock leader fires, each slot fires exactly once, after downtime the missed-run policy applies, and pausing stops firing

### US-12.3 Schedule in local time (RM) — pending

Tickets: RY-103 · FR-087

- **Given** a schedule `30 2 * * *` in `Europe/Berlin`
- **When** DST starts (02:30 does not exist)
- **Then** it fires at the next valid minute; when DST ends (02:30 occurs twice) it fires once

---

## E13 Metrics & Observability

### US-13.1 See queue health (PE) — pending

Tickets: RY-110, RY-111, RY-112 · FR-089, FR-090, FR-091

- **Given** a day of runs
- **When** I open Metrics
- **Then** I see queue depth and p50/p90/p99 queue time and duration per project as SVG charts, and `/metrics` exposes the same counters in Prometheus text format

### US-13.2 Find flaky jobs and slow paths (DEV) — pending

Tickets: RY-113, RY-114, RY-115 · FR-092, FR-093, FR-094

- **Given** a job that succeeded only after retry in 6 of the last 20 runs
- **When** I open the project
- **Then** it is flagged as flaky; I can export a run timeline as OTLP-compatible JSON; a queue-time SLO breach raises an in-app alert

---

## E14 Web UI

### US-14.1 Navigate the app and see what is coming (OWN) — done

Tickets: RY-120 · FR-095

- **Given** I am signed in
- **When** I open the app at `http://localhost:5105`
- **Then** the navigation shows Projects and the sections Secrets, Environments, Schedules, Runners, Artifacts, Metrics and Settings with a "Planned" badge, each opening a placeholder naming its ticket

### US-14.2 Manage projects and runs in the browser (DEV) — done

Tickets: RY-121, RY-125 · FR-096, FR-099

- **Given** I am on Projects
- **When** I create a project with an invalid slug
- **Then** the field error from the API is shown next to the field; after a valid submission the project appears and its Runs list shows number, status, branch, SHA and age

### US-14.3 Read the run as a graph (DEV) — done

Tickets: RY-122 · FR-097

- **Given** a run with 3 levels
- **When** I open Run detail
- **Then** jobs appear in 3 columns connected by SVG edges, critical-path edges are highlighted, statuses update live, and clicking a node opens its log

### US-14.4 Author pipelines with instant feedback (DEV) — done

Tickets: RY-036 · FR-030

- **Given** the Pipeline editor with sample YAML
- **When** I edit and validate
- **Then** issues are listed with line and column, and for valid YAML the plan preview shows levels, instances and excluded jobs

### US-14.5 Use the app comfortably (DEV) — pending

Tickets: RY-126, RY-127, RY-128, RY-129 · FR-100, FR-101, NFR-024, NFR-025

- **Given** keyboard-only navigation
- **When** I traverse the run graph and log viewer
- **Then** every control is reachable with visible focus; the layout works at 360 px and in dark theme; Settings manages members and tokens; a visual editor round-trips YAML

---

## E15 Operations

### US-15.1 Back up and restore (PE) — pending

Tickets: RY-140, RY-143, RY-145 · FR-107, FR-108, NFR-027

- **Given** a production installation
- **When** I run the backup script
- **Then** a `pg_dump` plus archived logs and artifacts are written; restoring onto a clean VM reproduces projects and run history; retention jobs delete runs older than the policy in batches

### US-15.2 Prove it scales and is hardened (SEC) — pending

Tickets: RY-141, RY-142, RY-144 · NFR-021, NFR-022, NFR-023

- **Given** 10k queued jobs and 50 runners
- **When** the load test runs
- **Then** lease p99 stays under 50 ms, killing one of two API nodes keeps SSE viewers resuming within 5 s, and the ASVS L2 review has no open high findings

### US-15.3 Drive Railyard from a terminal (DEV) — pending

Tickets: RY-147, RY-146, RY-148 · FR-110, FR-109, NFR-030

- **Given** a personal API token
- **When** I run `railyard validate .railyard.yml` and `railyard run --follow`
- **Then** issues print with line numbers and logs stream until the run ends; operators can manage organizations from a console; the user guide documents the workflow

---

## E16 Notifications

### US-16.1 Hear about failures (DEV) — pending

Tickets: RY-130, RY-131 · FR-102

- **Given** I triggered a run
- **When** it fails
- **Then** I get an in-app notification and an email copy is written to the local outbox file sink

### US-16.2 Show build status where people look (OWN) — pending

Tickets: RY-132, RY-133 · FR-103

- **Given** a project with a green `main`
- **When** the README embeds the badge URL
- **Then** an SVG "passing" badge renders, and the run's final status is recorded as a git note on the commit in the bare repository
