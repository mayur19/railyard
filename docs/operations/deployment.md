# Deployment

How to run Railyard on bare metal or a VM with native processes: systemd for the API and runners, nginx for TLS, static files and the `/api` proxy, and a natively installed PostgreSQL. There are no container images and none are planned; the runner itself executes build steps as plain processes (see [threat-model.md](../security/threat-model.md) for what that implies).

Day-two operations (config reference, backups, troubleshooting, SQL) are in [runbook.md](runbook.md). Release packaging as a tarball with these units and the nginx sample is tracked as RY-009.

## 1. Topologies

### 1.1 Single host (recommended start)

```mermaid
flowchart LR
  U[Users] -- HTTPS 443 --> N[nginx]
  N -- static files --> D[/opt/railyard/current/apps/web/dist/]
  N -- "/api/* (127.0.0.1:4105)" --> A[railyard-api.service<br/>1 instance]
  A -- unix socket --> P[(PostgreSQL 15+)]
  R1[railyard-runner@1] -- unix socket --> P
  R2[railyard-runner@2] --> P
  R3[railyard-runner@N] --> P
  R1 --> W[(/var/lib/railyard/workspaces)]
```

### 1.2 Separate runner hosts

The API host keeps nginx, the API and PostgreSQL. Runner hosts run only `railyard-runner@.service` and connect to PostgreSQL over TCP with TLS (`sslmode=verify-full`) using the restricted `railyard_runner` role. Runners need no inbound ports. Put runner hosts in a network segment that cannot reach production systems: pipeline scripts run unsandboxed on them (RY-054, RY-058). Remote runners that talk HTTPS instead of SQL are planned in RY-056.

### 1.3 One API instance

Run **exactly one** `railyard-api` process until RY-151 moves login and registration throttling counters into Postgres. With two instances behind a load balancer every per-IP and per-email budget doubles and lockouts are lost when a request lands on the other node. Multi-node API with LISTEN/NOTIFY failover is RY-144. Runners scale horizontally today without restriction.

## 2. Host preparation

Tested layout for Debian 12 / Ubuntu 24.04; adapt package names for other distributions.

```bash
# Node.js 22 (NodeSource or distribution package), nginx, PostgreSQL 15+
sudo apt-get install -y nginx postgresql postgresql-contrib git
node -v   # v22.x

# Service users: API and runners are separate accounts
sudo useradd --system --home /var/lib/railyard --shell /usr/sbin/nologin railyard
sudo useradd --system --home /var/lib/railyard-runner --create-home --shell /usr/sbin/nologin railyard-runner

# Directories
sudo install -d -o railyard -g railyard -m 0750 /opt/railyard /opt/railyard/releases
sudo install -d -o root -g railyard -m 0750 /etc/railyard
sudo install -d -o railyard-runner -g railyard-runner -m 0750 /var/lib/railyard/workspaces
```

`/var/lib/railyard/workspaces` should be its own filesystem (or LVM volume) so a runaway build cannot fill `/` or the PostgreSQL data directory.

## 3. PostgreSQL

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE railyard LOGIN PASSWORD 'change-me-api';
CREATE DATABASE railyard OWNER railyard;
SQL
```

The runner role and its grants are created after the first API start (the API applies migrations, which create the tables). The statements are in [runbook.md section 4.3](runbook.md#43-database-roles-production).

`pg_hba.conf` for a single host (local socket, password auth, no peer trust for the runner account):

```
# TYPE  DATABASE  USER             ADDRESS        METHOD
local   railyard  railyard                        scram-sha-256
local   railyard  railyard_runner                 scram-sha-256
hostssl railyard  railyard_runner  10.20.0.0/24   scram-sha-256   # only for separate runner hosts
```

`postgresql.conf` starting points for a 4 vCPU / 8 GB host: `max_connections = 100` (API pool 10 + 1 LISTEN connection, 4 per runner, DB CLI 2), `shared_buffers = 2GB`, `effective_cache_size = 6GB`, `wal_compression = on`. Enable `log_min_duration_statement = 500ms` to spot slow queries.

## 4. Configuration files

Two environment files so the runner never holds the session secret of the API.

`/etc/railyard/railyard.env` (owner `root:railyard`, mode `0640`):

```bash
NODE_ENV=production
API_HOST=127.0.0.1
API_PORT=4105
APP_ORIGIN=https://ci.example.internal
DATABASE_URL=postgres://railyard:change-me-api@localhost/railyard?host=/var/run/postgresql
DATABASE_POOL_MAX=10
SESSION_SECRET=<openssl rand -hex 32>
SESSION_TTL_HOURS=168
COOKIE_SECURE=true
LOG_LEVEL=info
# nginx on the same host is the only proxy; required in production, `true` is rejected
TRUST_PROXY=127.0.0.1
LOGIN_IP_RATE_LIMIT=50
LOGIN_RATE_WINDOW_SECONDS=900
LOGIN_MAX_EMAILS_PER_IP=20
LOGIN_EMAIL_FREE_ATTEMPTS=5
LOGIN_BACKOFF_BASE_SECONDS=30
LOGIN_BACKOFF_MAX_SECONDS=3600
REGISTER_RATE_LIMIT=5
REGISTER_RATE_WINDOW_SECONDS=3600
RATE_LIMIT_MAX_KEYS=10000
```

`/etc/railyard/runner.env` (owner `root:railyard-runner`, mode `0640`):

```bash
NODE_ENV=production
DATABASE_URL=postgres://railyard_runner:change-me-runner@localhost/railyard?host=/var/run/postgresql
# Required by the shared config schema; runners never use it. Must differ from the API's secret.
SESSION_SECRET=<a different openssl rand -hex 32>
COOKIE_SECURE=true
TRUST_PROXY=false
LOG_LEVEL=info
WORKSPACE_ROOT=/var/lib/railyard/workspaces
RUNNER_LEASE_SECONDS=30
RUNNER_POLL_MS=1000
RUNNER_KEEP_WORKSPACES=false
```

`RUNNER_NAME` is set per instance by the systemd template, never in the shared file: each process needs a unique name because it is the lease owner.

## 5. systemd units

### 5.1 `/etc/systemd/system/railyard-api.service`

```ini
[Unit]
Description=Railyard API
After=network-online.target postgresql.service
Wants=network-online.target
Requires=postgresql.service

[Service]
Type=simple
User=railyard
Group=railyard
WorkingDirectory=/opt/railyard/current
EnvironmentFile=/etc/railyard/railyard.env
ExecStart=/usr/bin/node /opt/railyard/current/apps/api/dist/index.js
Restart=on-failure
RestartSec=3
# Migrations run on start-up; give a large upgrade time to finish
TimeoutStartSec=300
TimeoutStopSec=30
KillSignal=SIGTERM

# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
MemoryDenyWriteExecute=false
CapabilityBoundingSet=
ReadOnlyPaths=/opt/railyard
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

`MemoryDenyWriteExecute` stays off because V8's JIT needs writable executable memory. `LimitNOFILE` matters because every open SSE log stream holds a socket.

### 5.2 `/etc/systemd/system/railyard-runner@.service` (template, one instance per runner)

```ini
[Unit]
Description=Railyard runner %i
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=railyard-runner
Group=railyard-runner
WorkingDirectory=/var/lib/railyard-runner
EnvironmentFile=/etc/railyard/runner.env
Environment=RUNNER_NAME=%H-runner-%i
ExecStart=/usr/bin/node /opt/railyard/current/apps/api/dist/runner/cli.js
Restart=always
RestartSec=5
# SIGTERM lets the runner finish its current job. Jobs can run for hours; after this timeout
# systemd kills the whole cgroup (including detached step process groups) and the lease
# expires, so another runner's reaper retries or fails the attempt.
KillSignal=SIGTERM
KillMode=control-group
TimeoutStopSec=15min

# Hardening that does not break typical build steps
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
ReadWritePaths=/var/lib/railyard/workspaces /var/lib/railyard-runner
# Coarse per-runner limits until per-job limits land (RY-054)
MemoryMax=4G
TasksMax=2048
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

Start N runners:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now railyard-api
sudo systemctl enable --now railyard-runner@{1..4}
systemctl list-units 'railyard-runner@*'
```

`%H-runner-%i` gives names like `ci01-runner-3`, stable across restarts, so a restarted runner updates its existing `runners` row. Because each runner executes one job at a time, the number of instances is the build concurrency of the host.

`MemoryMax` and `TasksMax` apply to the runner and all of its step processes together, which is a useful fork-bomb and memory backstop, not isolation between jobs.

### 5.3 Optional: nightly backup timer

```ini
# /etc/systemd/system/railyard-backup.service
[Service]
Type=oneshot
User=postgres
ExecStart=/bin/sh -c 'pg_dump --format=custom --compress=6 --no-owner --file=/var/backups/railyard/railyard-$(date -u +%%Y%%m%%dT%%H%%M%%SZ).dump railyard && find /var/backups/railyard -name "railyard-*.dump" -mtime +14 -delete'

# /etc/systemd/system/railyard-backup.timer
[Timer]
OnCalendar=*-*-* 02:00:00 UTC
Persistent=true
[Install]
WantedBy=timers.target
```

## 6. nginx

`/etc/nginx/sites-available/railyard`:

```nginx
limit_req_zone $binary_remote_addr zone=railyard_api:10m rate=20r/s;

upstream railyard_api {
    server 127.0.0.1:4105;
    keepalive 16;
}

server {
    listen 80;
    server_name ci.example.internal;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name ci.example.internal;

    ssl_certificate     /etc/ssl/railyard/fullchain.pem;
    ssl_certificate_key /etc/ssl/railyard/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;

    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;
    add_header Referrer-Policy no-referrer always;
    add_header Content-Security-Policy "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" always;

    client_max_body_size 1m;   # API rejects bodies above 512 KiB itself

    # Static web build (single-page app)
    root /opt/railyard/current/apps/web/dist;
    location / {
        try_files $uri /index.html;
    }
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Live log streams (Server-Sent Events): no buffering, long-lived connections
    location ~ ^/api/runs/[^/]+/jobs/[^/]+/logs/stream$ {
        proxy_pass http://railyard_api;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Request-Id $request_id;
        proxy_buffering off;
        proxy_cache off;
        gzip off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    # Everything else under /api
    location /api/ {
        limit_req zone=railyard_api burst=40 nodelay;
        proxy_pass http://railyard_api;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Request-Id $request_id;
        proxy_read_timeout 60s;
    }
}
```

Notes:

- `TRUST_PROXY=127.0.0.1` matches this layout: nginx connects from loopback, so the API takes the client address from the `X-Forwarded-For` entry nginx appended. Do not use a hop count larger than the real number of proxies, and never trust a proxy you do not run.
- `proxy_buffering off` is what makes live logs live. The API also sends `X-Accel-Buffering: no` and a keep-alive comment every 15 s, which keeps `proxy_read_timeout` from firing on quiet jobs; one hour bounds abandoned connections, and `EventSource` reconnects with `Last-Event-ID` without losing lines.
- nginx's `X-Request-Id` (`$request_id`, 32 hex chars) passes the API's request id format check, so nginx access logs and API logs share one id.
- The generic `limit_req` complements the API's own login/registration throttles for all other endpoints.
- `Secure` cookies require HTTPS end to end from the browser's point of view; with `COOKIE_SECURE=true` a plain-HTTP origin cannot log in.

Enable: `sudo ln -s /etc/nginx/sites-available/railyard /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx`.

## 7. Building a release

Build on a CI machine or a build host with Node 22, never on the production host's runner account.

```bash
git clone https://github.com/<org>/railyard.git && cd railyard
git checkout v0.2.0
npm ci
npm run lint && npm run typecheck && npm test   # or ./run.sh check with a local Postgres
npm run build                                   # apps/api/dist and apps/web/dist
npm audit --omit=dev

# Package: compiled output, migrations, manifests and production dependencies
npm ci --omit=dev --workspace @railyard/api --include-workspace-root
tar -czf railyard-v0.2.0.tar.gz \
  package.json package-lock.json node_modules \
  apps/api/package.json apps/api/dist apps/api/migrations \
  apps/web/dist
sha256sum railyard-v0.2.0.tar.gz > railyard-v0.2.0.tar.gz.sha256
```

`apps/api/dist` is bundled by tsup with `@railyard/shared` inlined; runtime dependencies (`fastify`, `@fastify/cookie`, `pg`, `pino`, `zod`, and `yaml` via shared) come from `node_modules`. `apps/api/migrations` must ship next to `apps/api/dist`: the migration runner looks for it relative to the bundle (`../migrations` from `dist/index.js`, `../../migrations` from `dist/db/cli.js`).

## 8. Release procedure

Releases are directories under `/opt/railyard/releases/<version>`, with `/opt/railyard/current` a symlink to the active one.

1. **Read the release notes** for new migrations and new environment variables. Add new variables to the env files first; the API refuses to start on invalid configuration.
2. **Back up** the database: `sudo systemctl start railyard-backup.service` (or the `pg_dump` command from the runbook) and confirm the file exists.
3. **Unpack** the release:
   ```bash
   sha256sum -c railyard-v0.2.0.tar.gz.sha256
   sudo install -d -o railyard -g railyard /opt/railyard/releases/v0.2.0
   sudo tar -xzf railyard-v0.2.0.tar.gz -C /opt/railyard/releases/v0.2.0
   sudo chown -R railyard:railyard /opt/railyard/releases/v0.2.0
   ```
4. **Drain runners** so no job is mid-flight while the schema changes: `sudo systemctl stop 'railyard-runner@*'` (waits up to `TimeoutStopSec` for current jobs; queued jobs simply wait).
5. **Switch and restart the API**, which applies new migrations under an advisory lock before it starts listening:
   ```bash
   sudo ln -sfn /opt/railyard/releases/v0.2.0 /opt/railyard/current
   sudo systemctl restart railyard-api
   journalctl -u railyard-api -n 50 --no-pager   # look for "applied migration" lines and the listen address
   curl -fsS http://127.0.0.1:4105/api/ready
   ```
6. **Start runners**: `sudo systemctl start railyard-runner@{1..4}`. Re-apply the `railyard_runner` grants if the release added tables the runner uses.
7. **Smoke test**: log in through the public URL, open a run, watch a live log, and confirm a pending endpoint still answers `501` with its ticket.
8. **Reload nginx** only if the nginx config changed (`nginx -t` first). New static files are live as soon as the symlink moves.

The web UI and API come from the same release directory, so they cannot drift apart.

## 9. Rollback

Migrations are **forward-only**: there are no down scripts. An older API starts fine against a schema that has newer migrations recorded (it only verifies the checksums of the files it ships), so whether code can roll back depends on whether the newer migrations are backward compatible. What that means in practice:

| Situation                                                                                                                        | Rollback                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Release had **no new migrations**                                                                                                | point `current` back at the previous release and restart the API and runners.                                                                            |
| New migrations were **additive** (new tables, nullable columns, new indexes) and the release notes mark them backward compatible | same as above: the old code ignores what it does not know.                                                                                               |
| New migrations **changed or removed** something the old code needs                                                               | restore the pre-release backup (runbook section 6.2) **and** switch `current` back. Runs created after the upgrade are lost; export what you need first. |
| A migration **failed** during start-up                                                                                           | nothing was recorded (each migration runs in a transaction); the API did not start. Switch `current` back and restart; the schema is unchanged.          |

Rules that keep rollbacks cheap, enforced in review:

- Migrations are expand-then-contract across at least two releases: add a column in release N, start using it in N, drop the old one no earlier than N+1.
- Never edit an applied migration; the checksum check stops the API.
- Keep the previous two releases in `/opt/railyard/releases`.

Upgrade and rollback playbooks with rehearsal scripts are tracked in RY-145.

## 10. Sizing

Railyard's own processes are light; the runners' build steps dominate CPU, memory and disk.

| Component        | Small team (<= 20 users, <= 500 jobs/day) | Medium (<= 100 users, <= 5 000 jobs/day)                              |
| ---------------- | ----------------------------------------- | --------------------------------------------------------------------- |
| API              | 1 vCPU, 512 MB RSS headroom               | 2 vCPU, 1 GB                                                          |
| PostgreSQL       | 2 vCPU, 4 GB RAM, 50 GB SSD               | 4 vCPU, 16 GB RAM, 200 GB SSD                                         |
| Runners          | 2-4 instances on the same host            | dedicated runner hosts; 1 instance per 1-2 vCPU of the build workload |
| Workspaces disk  | 20 GB                                     | 100 GB per runner host                                                |
| Single box total | 4 vCPU, 8 GB RAM                          | split API+DB from runner hosts                                        |

Rules of thumb:

- **Log volume** drives database growth: each job attempt can store up to 5 MiB of log (hard truncation), typically far less. Estimate `jobs/day x average log size x retention days`, add 30% for indexes and bloat, and prune with the runbook query until retention jobs land (RY-143).
- **Connections**: `DATABASE_POOL_MAX + 1` for the API, 4 per runner, 2 for the DB CLI during migrations. 20 runners need about 95 connections.
- **SSE clients**: each open log view is one socket on nginx and the API and costs no extra database connection (one shared LISTEN connection per API process). Hundreds of concurrent viewers are fine on one API instance; large fan-out work is RY-066.
- **Queue latency** is bounded by `RUNNER_POLL_MS` (1 s) when runners are idle, and by runner count when they are busy. Watch the wait percentiles query in the runbook (8.7).
- **Planner cost** is negligible at current limits (at most 1000 planned jobs per run, inserted with three set-based statements); a formal budget is RY-149.

## 11. Pre-production checklist

- [ ] `NODE_ENV=production`, `COOKIE_SECURE=true`, HTTPS working, HSTS header present.
- [ ] `TRUST_PROXY=127.0.0.1` (or the real proxy addresses); audit log rows show real client IPs after a test login.
- [ ] Exactly one `railyard-api` process; `API_HOST=127.0.0.1`.
- [ ] Runners run as `railyard-runner`, use the `railyard_runner` DB role, and have no sudo rights.
- [ ] `/etc/railyard/*.env` are `0640`, owned by root, and backed up encrypted.
- [ ] `WORKSPACE_ROOT` on a separate filesystem with monitoring on free space.
- [ ] Nightly `pg_dump` timer enabled and one restore rehearsed.
- [ ] Demo seed **not** loaded (`SELECT count(*) FROM organizations WHERE slug = 'acme-rail'` returns 0).
- [ ] Live log stream works through nginx (lines appear while a job runs).
