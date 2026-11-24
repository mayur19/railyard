# Operations runbook

Day-to-day operation of a Railyard installation: configuration, the `run.sh` launcher, database lifecycle, runners, backup and restore, troubleshooting and diagnostic SQL. Production topology (systemd, nginx, sizing, releases) is in [deployment.md](deployment.md).

## 1. Processes at a glance

| Process | Entry point (dev)                                      | Entry point (built)                               | Instances                                              |
| ------- | ------------------------------------------------------ | ------------------------------------------------- | ------------------------------------------------------ |
| API     | `npm run dev -w @railyard/api`                         | `node apps/api/dist/index.js`                     | **exactly one** until RY-151 (in-memory rate limiters) |
| Runner  | `npm run runner -w @railyard/api`                      | `node apps/api/dist/runner/cli.js`                | any number, on one or many hosts                       |
| Web UI  | `npm run dev -w @railyard/web` (Vite, port `WEB_PORT`) | static files from `apps/web/dist` served by nginx | n/a                                                    |
| DB CLI  | `npm run db:migrate                                    | db:seed                                           | db:reset`                                              | `node apps/api/dist/db/cli.js migrate | seed | reset` | one-shot |

The API applies pending migrations on start-up (under an advisory lock), so a fresh database only needs the role and database to exist. Runners do not migrate.

## 2. Configuration

All server configuration comes from environment variables, validated by the zod schema in `apps/api/src/config/env.ts` when the API, a runner or the DB CLI starts. Invalid values abort start-up with every problem listed at once, for example:

```
Invalid configuration:
  SESSION_SECRET: SESSION_SECRET must be at least 32 characters
  TRUST_PROXY: TRUST_PROXY must be false, a hop count, or a comma-separated IP/CIDR list
```

In development the variables come from `.env` at the repository root (created from `.env.example` by `./run.sh`, mode `0600`). In production they come from systemd `EnvironmentFile=/etc/railyard/railyard.env`.

| Variable                       | Default                                              | Used by                      | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------ | ---------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                     | `development`                                        | all                          | `development`, `test` or `production`. `production` requires `COOKIE_SECURE=true` and makes `reset` refuse to run.                                                                                                                                                                                                                                                                                                                                                                      |
| `API_HOST`                     | `127.0.0.1`                                          | API                          | Bind address. Keep loopback behind nginx; never `0.0.0.0` on an internet-facing host.                                                                                                                                                                                                                                                                                                                                                                                                   |
| `API_PORT`                     | `4105`                                               | API                          | Listen port.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `WEB_PORT`                     | `5105`                                               | Vite dev server              | Port of the web dev server (development only; not read by `env.ts`). Vite proxies `/api` to the API.                                                                                                                                                                                                                                                                                                                                                                                    |
| `APP_ORIGIN`                   | `http://localhost:5105`                              | API                          | Public origin of the web UI (must be a URL). In production the HTTPS origin, e.g. `https://ci.example.internal`.                                                                                                                                                                                                                                                                                                                                                                        |
| `DATABASE_URL`                 | required                                             | all                          | PostgreSQL connection string. Local socket example: `postgres://railyard@localhost/railyard?host=/var/run/postgresql`.                                                                                                                                                                                                                                                                                                                                                                  |
| `DATABASE_POOL_MAX`            | `10`                                                 | API                          | Max connections in the API pool (1-100). The API additionally holds one dedicated LISTEN connection. Runners use a fixed pool of 4, the DB CLI 2.                                                                                                                                                                                                                                                                                                                                       |
| `SESSION_SECRET`               | required, >= 32 chars                                | API                          | HMAC key for session ids: `sessions.id = HMAC-SHA256(SESSION_SECRET, cookie token)`. Changing it invalidates every session. Generate with `openssl rand -hex 32`. Runners do not need it; give them a value only because the shared schema requires one (see 6.1).                                                                                                                                                                                                                      |
| `SESSION_TTL_HOURS`            | `168`                                                | API                          | Absolute session lifetime (1-720).                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `COOKIE_SECURE`                | `false`                                              | API                          | Adds `Secure` to `ry_session` and `ry_csrf`. Must be `true` in production (enforced). Accepts `true/false/1/0`.                                                                                                                                                                                                                                                                                                                                                                         |
| `LOG_LEVEL`                    | `info`                                               | all                          | pino level: `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`.                                                                                                                                                                                                                                                                                                                                                                                                               |
| `TRUST_PROXY`                  | `false` (must be set explicitly in production)       | API                          | Which proxies may set `X-Forwarded-For`. `false`/`0`/empty: use the socket address. A hop count (`1`..`99`): trust that many proxies. A comma-separated IP/CIDR list (`127.0.0.1` or `10.0.0.0/8,192.168.1.10`): trust only those addresses. **`true` is rejected** because it lets any client pick its IP and bypass per-IP login limits. With `NODE_ENV=production` start-up fails if the variable is absent, so the choice is always deliberate. Behind local nginx use `127.0.0.1`. |
| `LOGIN_IP_RATE_LIMIT`          | `50`                                                 | API                          | Login attempts (any outcome) per client IP per window.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `LOGIN_RATE_WINDOW_SECONDS`    | `900`                                                | API                          | Fixed window for the per-IP login limiter.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `LOGIN_MAX_EMAILS_PER_IP`      | `20`                                                 | API                          | Distinct email addresses one normalised client IP may try per `LOGIN_RATE_WINDOW_SECONDS`. Stops one client from cycling through many accounts and from flooding the per-email store with fresh keys.                                                                                                                                                                                                                                                                                   |
| `LOGIN_EMAIL_FREE_ATTEMPTS`    | `5`                                                  | API                          | Failed logins per email before backoff starts.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `LOGIN_BACKOFF_BASE_SECONDS`   | `30`                                                 | API                          | First lockout; doubles with each further failure.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `LOGIN_BACKOFF_MAX_SECONDS`    | `3600`                                               | API                          | Lockout cap. Failure history is forgotten 24 h after the last failure.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `REGISTER_RATE_LIMIT`          | `5`                                                  | API                          | Registration attempts per IP per window (counted before validation).                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `REGISTER_RATE_WINDOW_SECONDS` | `3600`                                               | API                          | Window for the registration limiter.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `RATE_LIMIT_MAX_KEYS`          | `10000`                                              | API                          | Upper bound on entries in each in-memory limiter store (min 10). When a store is full it sweeps expired entries with a resumable cursor; if every entry is still active it evicts the one with the least time left and logs `rate-limit store full; evicted active entry`. New keys are never refused because a store is full.                                                                                                                                                          |
| `WORKSPACE_ROOT`               | `.workspaces`                                        | runner                       | Root of per-job workspaces (`<root>/<runId>/<jobId>-a<attempt>`). Relative paths resolve against the runner's working directory; use an absolute path in production (`/var/lib/railyard/workspaces`).                                                                                                                                                                                                                                                                                   |
| `RUNNER_NAME`                  | `<hostname>-<pid>`                                   | runner                       | Identity used for the `runners` row and as `jobs.lease_owner`. **Must be unique per running process**: two processes with the same name would share lease ownership.                                                                                                                                                                                                                                                                                                                    |
| `RUNNER_LEASE_SECONDS`         | `30`                                                 | runner                       | Lease length (5-600). The runner extends it every third of this interval; the reaper requeues or fails jobs whose lease expired.                                                                                                                                                                                                                                                                                                                                                        |
| `RUNNER_POLL_MS`               | `1000`                                               | runner                       | Sleep between empty polls (50-60000). The reaper runs at most every 10 s inside the poll loop.                                                                                                                                                                                                                                                                                                                                                                                          |
| `RUNNER_KEEP_WORKSPACES`       | `false`                                              | runner                       | Keep workspaces after jobs finish (debugging only; disks fill up).                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `TEST_DATABASE_URL`            | `postgres://$USER@localhost/railyard_test?host=/tmp` | test suites, `./run.sh test` | Disposable database that the API test suites drop and recreate. Never point it at real data.                                                                                                                                                                                                                                                                                                                                                                                            |

Limiter keys use the **normalised** client IP: IPv4-mapped IPv6 (`::ffff:203.0.113.7`) becomes plain IPv4, and any other IPv6 address collapses to its `/64` prefix, because one subscriber usually controls a whole /64. Unknown variables are ignored, not rejected.

## 3. The `run.sh` launcher (development and single-box demos)

`./run.sh` without arguments is `./run.sh dev`. Every subcommand loads `.env` first, creating it from `.env.example` with a random `SESSION_SECRET` and your OS user name in the database URLs if it does not exist.

| Command                  | What it does                                                                                                                                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `./run.sh help`          | List commands.                                                                                                                                                                                                       |
| `./run.sh setup`         | Check Node 22+, npm, bash and `psql`; create `.env`; `npm ci` if `package-lock.json` changed; create `DATABASE_URL` and `TEST_DATABASE_URL` databases if missing; migrate; seed (idempotent). Prints the demo login. |
| `./run.sh dev` (default) | `setup`, then API + one runner + Vite with live reload (`npm run dev`, via `concurrently`). API on `API_PORT` (4105), UI on `APP_ORIGIN` (5105).                                                                     |
| `./run.sh migrate`       | Create the database if missing and apply pending migrations.                                                                                                                                                         |
| `./run.sh seed`          | Load demo data: organization `acme-rail`, users `owner@`, `dev@`, `viewer@railyard.local` (password `railyard-demo-pass`), projects Storefront and Payments API with runs. No-op if `acme-rail` exists.              |
| `./run.sh reset [--yes]` | Drop and recreate the `public` schema, migrate, seed. Asks for confirmation unless `--yes`. Refuses when `NODE_ENV=production` (both in `run.sh` and in `resetSchema`).                                              |
| `./run.sh runner`        | Start one additional runner in the foreground (use a second terminal; each gets a distinct `<hostname>-<pid>` name).                                                                                                 |
| `./run.sh test`          | Create `railyard_test` if missing and run all unit and integration tests.                                                                                                                                            |
| `./run.sh check`         | Lint, format check, typecheck, tests, build (what CI runs).                                                                                                                                                          |
| `./run.sh build`         | Production build: `apps/api/dist` (tsup bundles `index.js`, `db/cli.js`, `runner/cli.js` with `@railyard/shared` inlined) and `apps/web/dist`.                                                                       |
| `./run.sh e2e`           | `setup`, install Playwright Chromium if needed, run the Playwright smoke specs.                                                                                                                                      |

Local PostgreSQL is expected on the Unix socket in `/tmp` with the current OS user and no password (Homebrew default). On Debian/Ubuntu packages the socket lives in `/var/run/postgresql`; edit `?host=` in `.env` accordingly.

## 4. Database lifecycle

### 4.1 Migrations

- Plain SQL files in `apps/api/migrations/NNNN_name.sql`, applied in order, each in its own transaction, recorded in `schema_migrations (version, name, checksum, applied_at)`.
- An advisory lock (`pg_advisory_lock(41050001)`) serialises concurrent migrators, so an API start-up and a manual `migrate` cannot interleave.
- **Forward-only.** There are no down migrations. An applied file whose SHA-256 differs from the recorded checksum stops the API from starting (see 7.5).
- Manual run in production: `sudo -u railyard env $(cat /etc/railyard/railyard.env | xargs) node /opt/railyard/current/apps/api/dist/db/cli.js migrate`, or simply restart the API.

### 4.2 Seed and reset

- `seed` is for demos and development only. Do not seed production: it creates known passwords.
- `reset` destroys every table. It refuses to run with `NODE_ENV=production`.

### 4.3 Database roles (production)

| Role              | Used by         | Privileges                                                                                                                                                                               |
| ----------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `railyard`        | API, migrations | owner of the `railyard` database and schema                                                                                                                                              |
| `railyard_runner` | runners         | `CONNECT`; `SELECT, INSERT, UPDATE` on `jobs`, `job_steps`, `job_log_chunks`, `pipeline_runs`, `runners`; `USAGE` on identity sequences. No access to `users`, `sessions`, `audit_logs`. |

```sql
CREATE ROLE railyard_runner LOGIN PASSWORD '<long random>';
GRANT CONNECT ON DATABASE railyard TO railyard_runner;
GRANT USAGE ON SCHEMA public TO railyard_runner;
GRANT SELECT, INSERT, UPDATE ON jobs, job_steps, job_log_chunks, pipeline_runs, runners TO railyard_runner;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO railyard_runner;
```

Re-check the grant list after each release that adds migrations touched by the runner.

## 5. Runners

### 5.1 Starting runners

| Situation                 | Command                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| Development, extra runner | `./run.sh runner` or `npm run runner -w @railyard/api`                                     |
| Built release, foreground | `node --env-file=/etc/railyard/runner.env apps/api/dist/runner/cli.js`                     |
| Production                | `systemctl start railyard-runner@1 railyard-runner@2 ...` (template unit in deployment.md) |

On start a runner upserts its row in `runners` (status `online`, labels `linux, shell`, version), logs `runner started`, and loops: reap expired leases (at most every 10 s), lease the oldest queued job with `FOR UPDATE SKIP LOCKED`, execute its steps, settle it. Runners coordinate only through Postgres; adding capacity is starting another process.

Each runner executes **one job at a time**. Concurrency equals the number of runner processes.

### 5.2 Stopping runners

`SIGTERM` or `SIGINT` sets a stop flag. The runner finishes the job it is executing (which can take up to that job's timeout, max 24 h), marks itself `offline`, closes its pool and exits. For a faster stop, let systemd's `TimeoutStopSec` expire: the process group is killed, the lease expires after `RUNNER_LEASE_SECONDS`, and another runner's reaper treats the attempt as failed, which requeues it if retries remain. Graceful drain is planned in RY-055.

### 5.3 Security posture

Pipeline steps run as the runner's OS user with no container or sandbox (RY-054, RY-058 pending). Run runners as a dedicated unprivileged user (`railyard-runner`), never as root or as the API user, and with the restricted DB role above. The step environment is built from scratch, so `DATABASE_URL` and `SESSION_SECRET` are not passed to scripts, but the scripts can still read any file the runner user can read. See [threat-model.md](../security/threat-model.md).

## 6. Backup and restore

Everything that matters is in PostgreSQL. Workspaces are disposable; there are no artifacts or caches on disk yet (RY-080, RY-083).

### 6.1 Backup

```bash
# Nightly logical backup, custom format (compressed, parallel-restorable)
sudo -u postgres pg_dump --format=custom --compress=6 --no-owner \
  --file=/var/backups/railyard/railyard-$(date -u +%Y%m%dT%H%M%SZ).dump railyard

# Keep 14 days
find /var/backups/railyard -name 'railyard-*.dump' -mtime +14 -delete
```

- `pg_dump` takes a consistent snapshot; running jobs keep working during the dump.
- Also back up `/etc/railyard/*.env` (contains `SESSION_SECRET` and DB passwords) separately and encrypted. Without the same `SESSION_SECRET`, a restored database works but every user must log in again.
- `job_log_chunks` is usually the largest table. To skip log contents in an extra, smaller dump: `--exclude-table-data=job_log_chunks`.
- Verify backups weekly by restoring into a scratch database (below) and running `SELECT count(*) FROM pipeline_runs`.
- Backup and restore tooling with retention and verification is planned in RY-140.

### 6.2 Restore

```bash
# 1. Stop writers
sudo systemctl stop railyard-api 'railyard-runner@*'

# 2. Restore into a fresh database
sudo -u postgres dropdb --if-exists railyard_restore
sudo -u postgres createdb --owner=railyard railyard_restore
sudo -u postgres pg_restore --dbname=railyard_restore --role=railyard --no-owner --jobs=4 \
  /var/backups/railyard/railyard-20261124T020000Z.dump

# 3. Swap names (keeps the broken database for forensics)
sudo -u postgres psql -c "ALTER DATABASE railyard RENAME TO railyard_broken_$(date +%Y%m%d)"
sudo -u postgres psql -c "ALTER DATABASE railyard_restore RENAME TO railyard"

# 4. Re-apply grants for railyard_runner (section 4.3), then start
sudo systemctl start railyard-api
sudo systemctl start railyard-runner@{1..4}
```

After restore, jobs that were `running` at backup time still hold leases from runners that no longer exist; the reaper settles them within `RUNNER_LEASE_SECONDS` plus 10 s of the first runner starting (failed attempt, requeued if retries remain).

Restoring a backup taken by an **older** release into a **newer** release is fine (the API migrates forward on start). Restoring a newer backup under an older release is not supported (forward-only migrations): restore with the release that took the dump.

## 7. Troubleshooting

### 7.1 Jobs stay `queued`

1. `curl -s http://127.0.0.1:4105/api/ready` and look at `queuedJobs` and `onlineRunners`.
2. `onlineRunners` counts rows in `runners` with `last_heartbeat_at` in the last minute. Every runner refreshes its row at least every 15 seconds from its main loop (idle or busy), so a runner missing from the count for more than a minute is stopped, hung, or cannot reach the database.
3. No runner process: start one (5.1). Check its journal for `Invalid configuration` or connection errors: `journalctl -u railyard-runner@1 -n 100`.
4. Runners alive but idle: check they point at the same database as the API (`DATABASE_URL`), and that the queue query sees the jobs (SQL 8.2).
5. All runners busy: every runner runs one job at a time; long jobs block the queue. Add runner instances or shorten timeouts.

Jobs in `blocked` are waiting for dependencies, not for runners; see SQL 8.3.

### 7.2 Jobs stuck in `running`, or `lease expired (runner lost)` failures

- A runner crashed, was `kill -9`ed, lost its DB connection, or its host was suspended. The lease expires after `RUNNER_LEASE_SECONDS` (30 s) and the next reaper pass (any runner, every 10 s at most) fails the attempt with `failure_reason = 'lease expired (runner lost)'`; if `attempt <= retries` the job is requeued.
- If no runner is alive, nothing reaps. Start any runner.
- Frequent expiries with healthy runners: the heartbeat (every `RUNNER_LEASE_SECONDS / 3`) cannot reach the database in time. Look for `heartbeat failed` warnings, database load, or a too-short lease; raise `RUNNER_LEASE_SECONDS` to 60-120 on slow links.
- A runner that discovers it lost its lease aborts the job and logs `lease lost; result discarded`; this is expected after a long DB outage.

### 7.3 Live logs do not update behind nginx

Symptoms: the log view only shows output after the job finishes, or the stream reconnects every 60 s.

- The `/api/runs/` SSE location needs `proxy_buffering off`, `proxy_cache off`, `proxy_http_version 1.1`, `proxy_set_header Connection ''` and `proxy_read_timeout 3600s` (full block in deployment.md). The API also sends `X-Accel-Buffering: no`, but do not rely on it alone.
- `gzip` must not apply to `text/event-stream`.
- Check the API side: `curl -N -b cookies.txt http://127.0.0.1:4105/api/runs/<run>/jobs/<job>/logs/stream` directly on the host. If this streams but the proxied URL does not, it is the proxy.
- If the direct stream also stalls, check the API journal for `log hub connection error`: the dedicated LISTEN connection reconnects after 1 s while subscribers exist. Persisted logs are still available via `GET .../logs`.

### 7.4 Disk full under `WORKSPACE_ROOT`

- Symptoms: steps fail with `No space left on device`, or the runner logs `job execution error` on `createWorkspace`.
- Workspaces are deleted after each job unless `RUNNER_KEEP_WORKSPACES=true`; a crash between job end and cleanup leaves directories behind.
- Find leftovers: `du -sh /var/lib/railyard/workspaces/* | sort -h | tail`. A run directory is safe to delete when the run is terminal (SQL 8.6). With all runners stopped, the whole tree can be removed.
- Put `WORKSPACE_ROOT` on its own filesystem so builds cannot fill `/` or the PostgreSQL volume. Quotas and automatic cleanup are planned in RY-057.

### 7.5 API refuses to start: `checksum mismatch for applied migration NNNN_x.sql`

An applied migration file was edited after it ran. Migrations are forward-only.

1. Do not edit `schema_migrations` to silence it.
2. Restore the original file content from the release that applied it (`git show <tag>:apps/api/migrations/NNNN_x.sql`).
3. Put the intended change in a new migration with the next number.
4. Only if you are certain the database matches the edited file (for example a comment-only change in a development database), update the stored checksum: `UPDATE schema_migrations SET checksum = '<sha256 of file>' WHERE version = 'NNNN';` (`shasum -a 256 file.sql`).

Other migration errors: `migration NNNN_x.sql failed: ...` means the SQL itself failed and was rolled back; nothing was recorded. Fix and restart.

### 7.6 Users locked out of login

- `429 RATE_LIMITED` with `Retry-After` comes from the per-IP window or the per-email backoff. Both live in API memory: restarting the API clears them. Prefer waiting; restart only for a confirmed false positive.
- Everyone behind one corporate NAT shares one IP. If legitimate users hit the per-IP limit, raise `LOGIN_IP_RATE_LIMIT` instead of disabling it.
- All requests appearing to come from `127.0.0.1` in audit logs means `TRUST_PROXY` is not set behind nginx; every user then shares one bucket. Set `TRUST_PROXY=127.0.0.1`.
- Repeated `rate-limit store full; evicted active entry` warnings mean more than `RATE_LIMIT_MAX_KEYS` keys were active in one store inside a window, which is usually a distributed attack. Evicted entries lose their throttle state early; raise `RATE_LIMIT_MAX_KEYS` (memory cost is small, roughly a few hundred bytes per key) and add `limit_req` in nginx.

### 7.7 Other start-up errors

| Message                                            | Cause                                        | Fix                                                                                      |
| -------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `COOKIE_SECURE must be true in production`         | `NODE_ENV=production` without secure cookies | set `COOKIE_SECURE=true` (TLS via nginx)                                                 |
| `SESSION_SECRET must be at least 32 characters`    | missing or short secret                      | `openssl rand -hex 32`                                                                   |
| `TRUST_PROXY must be false, a hop count, ...`      | `TRUST_PROXY=true` or a hostname             | use `127.0.0.1`, a CIDR list, or a hop count                                             |
| `TRUST_PROXY must be set explicitly in production` | `NODE_ENV=production` without `TRUST_PROXY`  | set `TRUST_PROXY=127.0.0.1` behind local nginx, or `false` when clients connect directly |
| `EADDRINUSE 127.0.0.1:4105`                        | another API instance is running              | stop it; only one API instance is supported                                              |
| `/api/ready` returns 503 `NOT_READY`               | database unreachable                         | `pg_isready`, check `DATABASE_URL`, `max_connections`                                    |

### 7.8 Revoking sessions

There is no UI yet (RY-029). To log out one user everywhere:

```sql
DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE lower(email) = lower('dev@railyard.local'));
```

To disable an account: `UPDATE users SET disabled_at = now() WHERE lower(email) = lower('...');` (existing sessions stop working immediately). To log out everyone, rotate `SESSION_SECRET` and restart the API.

## 8. Useful SQL

Connect with `sudo -u postgres psql railyard` (or `psql "$DATABASE_URL"`).

**8.1 Queue overview**

```sql
SELECT status, count(*) FROM jobs GROUP BY status ORDER BY status;
```

**8.2 Oldest queued jobs and their wait time**

```sql
SELECT j.id, r.number AS run, p.slug AS project, j.key, now() - j.queued_at AS waiting
FROM jobs j JOIN pipeline_runs r ON r.id = j.run_id JOIN projects p ON p.id = r.project_id
WHERE j.status = 'queued' ORDER BY j.queued_at LIMIT 20;
```

**8.3 Why is a job blocked? (dependency statuses)**

```sql
SELECT j.key, j.status, j.run_when, d.key AS needs, d.status AS needs_status
FROM jobs j CROSS JOIN LATERAL unnest(j.needs) AS n(dep)
JOIN jobs d ON d.run_id = j.run_id AND d.key = n.dep
WHERE j.run_id = '<run id>' AND j.status = 'blocked';
```

**8.4 Running jobs, owners and lease health**

```sql
SELECT id, key, lease_owner, attempt, lease_expires_at - clock_timestamp() AS lease_left, now() - started_at AS running_for
FROM jobs WHERE status = 'running' ORDER BY lease_expires_at;
```

**8.5 Runners**

```sql
SELECT name, hostname, status, version, labels, last_heartbeat_at FROM runners ORDER BY last_heartbeat_at DESC;
-- Remove rows of runners that will never come back (names are reused only if RUNNER_NAME is fixed)
DELETE FROM runners WHERE status = 'offline' AND last_heartbeat_at < now() - interval '7 days';
```

**8.6 Recent failures with reasons**

```sql
SELECT p.slug, r.number, j.key, j.status, j.attempt, j.exit_code, j.failure_reason, j.finished_at
FROM jobs j JOIN pipeline_runs r ON r.id = j.run_id JOIN projects p ON p.id = r.project_id
WHERE j.status IN ('failed', 'timed_out') AND j.finished_at > now() - interval '24 hours'
ORDER BY j.finished_at DESC LIMIT 50;
```

**8.7 Queue wait and duration percentiles (last 7 days)**

```sql
SELECT percentile_cont(ARRAY[0.5, 0.9, 0.99]) WITHIN GROUP (ORDER BY extract(epoch FROM started_at - queued_at)) AS wait_s,
       percentile_cont(ARRAY[0.5, 0.9, 0.99]) WITHIN GROUP (ORDER BY extract(epoch FROM finished_at - started_at)) AS run_s
FROM jobs WHERE finished_at > now() - interval '7 days' AND started_at IS NOT NULL;
```

(`started_at` keeps the first attempt's start, so retried jobs report the wait before their first attempt.)

**8.8 Table sizes (log growth)**

```sql
SELECT relname, pg_size_pretty(pg_total_relation_size(oid)) FROM pg_class
WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace ORDER BY pg_total_relation_size(oid) DESC;
```

**8.9 Manually delete old logs** (until retention jobs land in RY-143)

```sql
DELETE FROM job_log_chunks c USING jobs j, pipeline_runs r
WHERE c.job_id = j.id AND j.run_id = r.id AND r.finished_at < now() - interval '90 days';
VACUUM (ANALYZE) job_log_chunks;
```

**8.10 Recent failed logins (audit log)**

```sql
SELECT created_at, ip, metadata->>'email' AS email FROM audit_logs
WHERE action = 'auth.login_failed' AND created_at > now() - interval '1 hour' ORDER BY created_at DESC;
```

**8.11 Applied migrations**

```sql
SELECT version, name, applied_at FROM schema_migrations ORDER BY version;
```

**8.12 Live notifications** (watch what SSE clients receive)

```sql
LISTEN railyard_jobs; LISTEN railyard_logs;   -- then wait; payloads are {"jobId","seq"} and {"runId","jobId","status"}
```
