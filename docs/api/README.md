# Railyard HTTP API

The machine-readable contract is [openapi.yaml](openapi.yaml) (OpenAPI 3.1). It describes the **full target API**: 15 operations are `x-status: implemented`, 38 are `x-status: pending`. Each pending operation names its backlog ticket in `x-ticket` (see [backlog.md](../planning/backlog.md)).

This page covers the conventions the spec cannot express well: the envelope, error codes, pagination, the session/CSRF flow, live log streaming, rate limits, and copy-pasteable curl sessions.

## Conventions

| Topic            | Rule                                                                                                                                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base URL         | `http://127.0.0.1:4105` in development (`API_HOST`/`API_PORT`). In production the API sits behind nginx on the same origin as the web UI, under `/api`.                                                                    |
| Paths            | Everything lives under `/api`. Resources are plural nouns (`/api/projects`, `/api/runs`); actions that are not CRUD are sub-resources with a verb (`/api/runs/{id}/cancel`).                                               |
| IDs              | UUID v4 strings for every entity. Runs additionally have a per-project `number` (1, 2, 3 ...) reserved atomically, used for display and pagination.                                                                        |
| Bodies           | `application/json`, UTF-8, max **512 KiB** per request (pipeline YAML itself is capped at 256 KiB).                                                                                                                        |
| Timestamps       | ISO 8601 in UTC (`2026-11-25T09:14:03.120Z`), stored as `timestamptz`.                                                                                                                                                     |
| Field names      | camelCase in JSON; snake_case in SQL.                                                                                                                                                                                      |
| Validation       | Every body, path parameter and query string is parsed with a zod schema from `packages/shared/src/api/schemas.ts` or the route module before any work happens. Emails and slugs are trimmed and lower-cased by the schema. |
| Tenancy          | Every authenticated read and write is scoped to the caller's organization in the repository layer. A resource in another organization answers `404`, exactly like a missing one.                                           |
| Request IDs      | Send `x-request-id` (8-64 chars of `[A-Za-z0-9._-]`) to correlate; otherwise the server creates a UUID. The value is echoed in the `x-request-id` response header, written to structured logs and stored on audit entries. |
| Security headers | Every response carries `x-content-type-options: nosniff`, `x-frame-options: DENY`, `referrer-policy: no-referrer`, `cache-control: no-store`.                                                                              |
| Permissions      | Each operation lists the permission it needs in `x-permission`. Role grants live in `ROLE_PERMISSIONS` (`packages/shared/src/api/schemas.ts`).                                                                             |

### Roles and permissions

| Permission          | owner | admin | developer | viewer |
| ------------------- | :---: | :---: | :-------: | :----: |
| `project:read`      |  yes  |  yes  |    yes    |  yes   |
| `run:read`          |  yes  |  yes  |    yes    |  yes   |
| `pipeline:validate` |  yes  |  yes  |    yes    |   -    |
| `run:create`        |  yes  |  yes  |    yes    |   -    |
| `run:cancel`        |  yes  |  yes  |    yes    |   -    |
| `project:write`     |  yes  |  yes  |     -     |   -    |
| `secret:write`      |  yes  |  yes  |     -     |   -    |
| `runner:manage`     |  yes  |  yes  |     -     |   -    |
| `audit:read`        |  yes  |  yes  |     -     |   -    |
| `org:manage`        |  yes  |   -   |     -     |   -    |

## Response envelope

Every JSON response, success or failure, has the same shape:

```json
{ "data": <payload or null>, "error": { "code": "...", "message": "...", "details": <optional> } | null, "meta": { ... } }
```

- Success: `data` holds the payload, `error` is `null`. `meta` appears only when there is something to say (pagination cursor, log progress).
- Failure: `data` is `null`, `error.code` is a stable machine code, `error.message` is safe to show to a user, `error.details` is optional structured context.
- Exceptions: `POST /api/auth/logout` answers `204` with no body; the SSE endpoint answers `text/event-stream` once the stream is open (authentication and lookup failures before that are normal JSON envelopes).

Unhandled exceptions are logged with the request id and full error server-side, and the client only receives `500 INTERNAL` / `Internal server error`; stack traces, SQL and file paths never leave the process.

## Error codes

| Code                  | HTTP | When                                                                                                                               | `details`                                                      |
| --------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `VALIDATION_FAILED`   | 400  | A body, path or query value failed its zod schema                                                                                  | `[{ path, message }]`, one entry per problem                   |
| `BAD_REQUEST`         | 400  | Malformed JSON or another framework-level request error                                                                            | -                                                              |
| `UNAUTHENTICATED`     | 401  | No `ry_session` cookie, or the session is unknown, expired, or its user is disabled                                                | -                                                              |
| `INVALID_CREDENTIALS` | 401  | Login with an unknown email or a wrong password (identical response for both)                                                      | -                                                              |
| `FORBIDDEN`           | 403  | Authenticated, but the role lacks the operation's `x-permission`                                                                   | -                                                              |
| `CSRF_FAILED`         | 403  | Mutating request without `x-csrf-token`, or with a token that does not match the session                                           | -                                                              |
| `NOT_FOUND`           | 404  | Unknown route, or the resource does not exist in the caller's organization                                                         | -                                                              |
| `CONFLICT`            | 409  | Duplicate project slug within the organization; or registration rejected (one generic message for "email exists" and "slug taken") | -                                                              |
| `PAYLOAD_TOO_LARGE`   | 413  | Body larger than 512 KiB                                                                                                           | -                                                              |
| `PIPELINE_INVALID`    | 422  | `POST /api/projects/{id}/runs` with YAML that fails validation or planning                                                         | `{ issues: PipelineIssue[] }`                                  |
| `EMPTY_PLAN`          | 422  | Valid YAML, but every job was excluded by `if:` conditions for this branch/event                                                   | `{ excluded: [{ jobId, reason }] }`                            |
| `RATE_LIMITED`        | 429  | Login or registration throttle hit                                                                                                 | `{ retryAfterSeconds }`, also sent as the `Retry-After` header |
| `INTERNAL`            | 500  | Unexpected server error (logged with request id)                                                                                   | -                                                              |
| `NOT_IMPLEMENTED`     | 501  | A planned route (`x-status: pending`)                                                                                              | `{ ticket: "RY-xxx" }`                                         |
| `NOT_READY`           | 503  | `GET /api/ready` could not reach Postgres                                                                                          | -                                                              |

Clients should branch on `error.code`, never on `message` text.

`POST /api/pipelines/validate` does **not** use `PIPELINE_INVALID`: a validation request that was well formed is a successful request, so it answers `200` with `data.valid = false` and the list of issues. Each `PipelineIssue` has `severity`, a stable `code` (for example `unknown_job`, `cycle`, `expression_syntax`, `not_yet_executed`), a document `path` such as `jobs.unit.matrix.node[2]`, a `message`, and `line`/`column` when the location is known.

## Pagination

List endpoints that can grow without bound use **keyset (cursor) pagination**, never offsets.

- Query: `limit` (1-100, default 25) and optional `cursor`.
- Response: `meta.nextCursor` (string or `null`) and `meta.limit`.
- Keep requesting with `cursor=<meta.nextCursor>` until `nextCursor` is `null`.

For `GET /api/projects/{id}/runs` the order is newest first and the cursor is the number of the last run on the page; the next page holds runs with a strictly lower number. Inserting new runs while paging does not shift or duplicate entries. The server fetches `limit + 1` rows to decide whether another page exists, so the last page never needs an extra empty request.

Treat cursors as opaque: the planned endpoints (commits, audit log) use different cursor encodings.

`GET /api/runs/{id}/jobs/{jobId}/logs` is a sequence feed, not a page list: pass `after=<meta.lastSeq>` (default 0) and `limit` (1-5000, default 1000) and stop once `meta.complete` is `true` (the job is terminal and the response held fewer than `limit` chunks).

## Authentication and CSRF

Railyard uses server-side sessions in Postgres, not bearer tokens. Personal API tokens for scripts are planned (RY-028).

1. **Register or log in.** `POST /api/auth/register` (201) or `POST /api/auth/login` (200) sets two cookies, both `Path=/; SameSite=Lax`, `Secure` when `COOKIE_SECURE=true`, expiring after `SESSION_TTL_HOURS` (default 168 h):
   - `ry_session`: random 256-bit token, **HttpOnly**. Postgres stores only `HMAC-SHA256(SESSION_SECRET, token)`, so a database dump cannot be replayed as cookies.
   - `ry_csrf`: the CSRF token bound to that session, readable by JavaScript.

   The response body also carries `data.csrfToken`.

2. **Read requests** (`GET`) need only the cookie.
3. **Mutating requests** (`POST`, `PUT`, `PATCH`, `DELETE`) on authenticated routes must send `x-csrf-token: <csrfToken>`. The server compares it to the token stored with the session (not merely to the cookie), so a token from another session is rejected. The check runs before the permission check, so a missing token gives `403 CSRF_FAILED` even for roles that would be denied anyway.
4. **Recover the token** after a page reload with `GET /api/auth/me`, or read the `ry_csrf` cookie.
5. **Log out** with `POST /api/auth/logout` (requires the CSRF header). The session row is deleted and both cookies cleared.

Login and registration themselves do not require a CSRF header (there is no session yet); a cross-site HTML form can only send `application/x-www-form-urlencoded`, `multipart/form-data` or `text/plain` bodies, none of which pass the JSON object schemas, and a cross-site `fetch` with `application/json` triggers a CORS preflight the API never approves. Successful and failed logins, registrations and logouts are written to `audit_logs`.

## Live logs (Server-Sent Events)

`GET /api/runs/{id}/jobs/{jobId}/logs/stream` returns `text/event-stream`:

```
retry: 2000

event: status
data: {"status":"running"}

event: log
id: 17
data: {"seq":17,"stream":"stdout","content":"\u001b[32mPASS\u001b[0m 42 tests\n"}

: keep-alive

event: status
data: {"status":"succeeded"}

event: end
data: {}
```

- `log` events carry `id: <seq>`. `seq` is strictly increasing per job and continuous across retry attempts.
- `status` is sent once on connect, then on every job transition. After a terminal status (`succeeded`, `failed`, `timed_out`, `cancelled`, `skipped`) the server sends `end` and closes.
- **Resume**: the browser `EventSource` sends `Last-Event-ID` automatically on reconnect and the server back-fills from there. Non-browser clients can send the header themselves or use `?after=<seq>`; the header wins.
- Back-fill and live delivery go through a single ordered chain, so each chunk is delivered exactly once, in order, even if a notification arrives during back-fill.
- A `: keep-alive` comment every 15 s keeps proxies from closing idle streams. The response sets `X-Accel-Buffering: no`; nginx must still have `proxy_buffering off` and a long `proxy_read_timeout` for this location (see [deployment.md](../operations/deployment.md)).
- `content` is raw terminal output including ANSI SGR colour codes; the web UI renders them with `parseAnsi` from `packages/shared`. Known secret values have already been replaced by `***` by the runner.

Browser usage (cookies are sent automatically on the same origin):

```ts
const source = new EventSource(`/api/runs/${runId}/jobs/${jobId}/logs/stream`);
source.addEventListener('log', (e) => append(JSON.parse(e.data)));
source.addEventListener('status', (e) => setStatus(JSON.parse(e.data).status));
source.addEventListener('end', () => source.close());
```

## Rate limits

| Limiter                | Key                  | Algorithm                                                                                                                                                                                                                                                                                                                    | Defaults (env)                                                                                                                                                             | Purpose                                                                             |
| ---------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Login per IP           | normalised client IP | fixed window, counts every attempt                                                                                                                                                                                                                                                                                           | 50 per 900 s (`LOGIN_IP_RATE_LIMIT`, `LOGIN_RATE_WINDOW_SECONDS`)                                                                                                          | password spraying: one source trying many accounts                                  |
| Distinct emails per IP | normalised client IP | at most N different emails per window; repeating an already-tried email is free                                                                                                                                                                                                                                              | 20 per 900 s (`LOGIN_MAX_EMAILS_PER_IP`, `LOGIN_RATE_WINDOW_SECONDS`)                                                                                                      | account cycling from one source; keeps one client from flooding the per-email store |
| Login per email        | normalised email     | progressive backoff: each attempt is reserved (counted as a failure) synchronously before any I/O and the counter is reset on success; 5 free (`LOGIN_EMAIL_FREE_ATTEMPTS`), then 30 s, 60 s, 120 s ... (`LOGIN_BACKOFF_BASE_SECONDS`) capped at 3600 s (`LOGIN_BACKOFF_MAX_SECONDS`); forgotten 24 h after the last failure | credential stuffing: many sources trying one account. Reserving up front means a burst of parallel requests cannot all pass the check before the first failure is recorded |
| Registration per IP    | client IP            | fixed window, checked before validation                                                                                                                                                                                                                                                                                      | 5 per 3600 s (`REGISTER_RATE_LIMIT`, `REGISTER_RATE_WINDOW_SECONDS`)                                                                                                       | bulk account creation and slug/email probing                                        |

All three answer `429 RATE_LIMITED` with `Retry-After`. Notes for operators:

- Counters are **in memory per API process**. Run exactly one API instance until RY-151 moves them to Postgres; with two instances an attacker gets twice the budget.
- Login checks run in the order per-IP window, distinct emails per IP, per-email backoff, all before the password is verified, so throttled requests never cost a scrypt computation.
- Client IPs are normalised before use as keys: IPv4-mapped IPv6 becomes IPv4, other IPv6 addresses collapse to their `/64`, so rotating addresses inside one subscriber prefix does not reset the limits.
- Each store is bounded by `RATE_LIMIT_MAX_KEYS` (10 000). A full store sweeps expired entries first and, if still full, evicts the active entry with the least time left and logs a warning; a new key is never locked out just because the store is full.
- "Client IP" is `request.ip`, which only honours `X-Forwarded-For` when `TRUST_PROXY` names the proxy (hop count or IP/CIDR list). The default `false` uses the socket address. `TRUST_PROXY=true` is rejected at start-up because it would let any client choose its own IP and bypass the limits, and with `NODE_ENV=production` the API refuses to start unless `TRUST_PROXY` is set explicitly.
- Other endpoints are not rate-limited by the API today; put a generic `limit_req` in nginx in front of `/api/` if the instance is internet-facing.

## curl examples

These assume the seeded demo data (`./run.sh seed`): organization `acme-rail`, user `owner@railyard.local`, password `railyard-demo-pass`. A cookie jar file keeps the session between calls.

```bash
API=http://127.0.0.1:4105
JAR=$(mktemp)

# Liveness and readiness
curl -s $API/api/health
curl -s $API/api/ready        # {"data":{"status":"ready","database":"up","queuedJobs":3,"onlineRunners":1},"error":null}

# Log in; keep cookies, capture the CSRF token
CSRF=$(curl -s -c $JAR -H 'content-type: application/json' \
  -d '{"email":"owner@railyard.local","password":"railyard-demo-pass"}' \
  $API/api/auth/login | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.csrfToken')

# Who am I (organization slug acme-rail, role owner)
curl -s -b $JAR $API/api/auth/me

# Projects
curl -s -b $JAR $API/api/projects
PROJECT=$(curl -s -b $JAR $API/api/projects | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.find(p => p.slug === "storefront").id')

# Create a project (mutating: needs the CSRF header)
curl -s -b $JAR -H "x-csrf-token: $CSRF" -H 'content-type: application/json' \
  -d '{"name":"Docs Site","slug":"docs-site","repositoryPath":"/srv/git/docs-site.git"}' \
  $API/api/projects

# Validate a pipeline and preview the plan for branch main
cat > /tmp/pipeline.yml <<'YAML'
version: 1
name: demo
stages: [build, test]
jobs:
  build:
    stage: build
    steps:
      - run: echo "building ${{ sha }}"
  test:
    stage: test
    matrix:
      node: [20, 22]
    steps:
      - run: echo "node ${{ matrix.node }}"
YAML
BODY=$(node -e 'process.stdout.write(JSON.stringify({yaml: require("fs").readFileSync("/tmp/pipeline.yml","utf8"), context: {branch: "main"}}))')
curl -s -b $JAR -H "x-csrf-token: $CSRF" -H 'content-type: application/json' \
  -d "$BODY" $API/api/pipelines/validate

# Start a run with the same YAML
RUN_BODY=$(node -e 'process.stdout.write(JSON.stringify({yaml: require("fs").readFileSync("/tmp/pipeline.yml","utf8"), branch: "main", sha: "f00dbabe1234"}))')
RUN=$(curl -s -b $JAR -H "x-csrf-token: $CSRF" -H 'content-type: application/json' \
  -d "$RUN_BODY" $API/api/projects/$PROJECT/runs | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.id')

# Run detail, then the run list (cursor pagination)
curl -s -b $JAR $API/api/runs/$RUN
curl -s -b $JAR "$API/api/projects/$PROJECT/runs?limit=2"
curl -s -b $JAR "$API/api/projects/$PROJECT/runs?limit=2&cursor=3"   # use meta.nextCursor from the previous page

# Logs of the first job: persisted chunks, then the live stream (-N disables curl buffering)
JOB=$(curl -s -b $JAR $API/api/runs/$RUN | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.jobs[0].id')
curl -s -b $JAR "$API/api/runs/$RUN/jobs/$JOB/logs?after=0&limit=500"
curl -N -s -b $JAR $API/api/runs/$RUN/jobs/$JOB/logs/stream
curl -N -s -b $JAR -H 'Last-Event-ID: 5' $API/api/runs/$RUN/jobs/$JOB/logs/stream   # resume after seq 5

# A pending endpoint: 501 with the ticket
curl -s -b $JAR -H "x-csrf-token: $CSRF" -X POST $API/api/runs/$RUN/cancel
# {"data":null,"error":{"code":"NOT_IMPLEMENTED","message":"Cancel a run is planned but not implemented yet","details":{"ticket":"RY-043"}}}

# Error examples
curl -s -b $JAR -X POST $API/api/projects -H 'content-type: application/json' -d '{}'   # 403 CSRF_FAILED
curl -s $API/api/projects                                                             # 401 UNAUTHENTICATED

# Log out
curl -s -b $JAR -c $JAR -H "x-csrf-token: $CSRF" -X POST -o /dev/null -w '%{http_code}\n' $API/api/auth/logout   # 204
```

Register a fresh organization (creates its own owner session):

```bash
curl -s -c $JAR -H 'content-type: application/json' -d '{
  "organizationName": "Northwind Freight",
  "organizationSlug": "northwind",
  "name": "Nadia Ops",
  "email": "nadia@northwind.example",
  "password": "correct-horse-battery-staple"
}' $API/api/auth/register
```

The demo database also contains `dev@railyard.local` (developer) and `viewer@railyard.local` (viewer) with the same password, which is useful for trying `403 FORBIDDEN` responses.

## Pending surface

The pending routes are registered by `apps/api/src/modules/pending/pending.routes.ts` with the same guard as real routes: a request without a session gets `401`, a viewer calling a `secret:write` route gets `403`, and only an authorised caller sees the `501` and its ticket. The integration suite (`apps/api/test/runs.http.test.ts`) iterates over the registry and checks every entry, and the spec's pending operations match that registry one to one.
