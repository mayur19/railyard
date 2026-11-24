# ADR-0017: Server-side sessions in Postgres with HttpOnly cookies, synchroniser CSRF tokens and scrypt password hashing

- Status: Accepted
- Date: 2026-11-24
- Tickets: RY-020, RY-021, RY-022; RY-028 (API tokens), RY-029 (session revocation UI)

## Context

Railyard is a browser-first application served from one origin, self-hosted, with no external identity provider. Sessions must be revocable immediately (member removal, password reset). The database may be backed up to less trusted places, so a leaked dump must not yield usable sessions. Password storage must resist offline cracking using only Node's standard library.

## Decision Drivers

- Immediate revocation and server-side expiry.
- Database leak must not allow session replay.
- CSRF protection for cookie-authenticated mutating requests.
- No native dependencies (bcrypt/argon2 bindings complicate offline installs).
- Equal response for unknown user and wrong password (no account enumeration by timing or message).

## Considered Options

1. JWT access tokens in `localStorage` with refresh tokens.
2. JWT in HttpOnly cookies (stateless).
3. Opaque random session token in an HttpOnly cookie, stored server-side only as HMAC-SHA256(SESSION_SECRET, token); per-session CSRF token checked on every mutating request; scrypt for passwords.
4. External OIDC provider.

## Decision Outcome

Chosen option: **3**.

- Session token: 32 random bytes (base64url) in cookie `ry_session` (`HttpOnly`, `SameSite=Lax`, `Secure` when `COOKIE_SECURE=true`, mandatory in production). Database key: `sessions.id = HMAC-SHA256(SESSION_SECRET, token)`; the raw token is never stored. TTL `SESSION_TTL_HOURS` (default 168); `last_seen_at` is touched on each authenticated request in the same query that validates expiry.
- CSRF: a random token per session stored in `sessions.csrf_token`, sent to the SPA in the readable `ry_csrf` cookie, required in the `X-CSRF-Token` header for every POST, PUT, PATCH and DELETE behind `guard()`. Mismatch returns `403 CSRF_FAILED`.
- Passwords: `scrypt` with N=16384, r=8, p=1, 64-byte key, 16-byte salt, encoded `scrypt$N$r$p$salt$hash` so parameters can be raised later; verified with `timingSafeEqual`. A precomputed dummy hash is verified when the user does not exist, equalising timing.
- RBAC: roles `owner`, `admin`, `developer`, `viewer` mapped to permissions in `ROLE_PERMISSIONS`; `guard(permission)` checks after authentication and CSRF.
- Throttling: on login a per-IP fixed window, a per-IP cap on distinct emails, and per-email progressive backoff, all decided and reserved synchronously before the first `await` so parallel requests cannot slip past; IPv6 addresses keyed by /64; per-IP limit on registration. Stores are in memory and bounded until RY-151.

### Consequences

- Positive: logout and future revocation (RY-029) take effect on the next request; a database dump alone cannot be replayed without `SESSION_SECRET`.
- Positive: no native modules; installs work offline from the npm cache.
- Negative: one indexed `UPDATE` per authenticated request. Acceptable at our scale; can be rate-limited to once per minute per session if it shows in profiles.
- Negative: rotating `SESSION_SECRET` logs everyone out (documented in the runbook).
- Negative: CLI and automation need a separate credential type; personal API tokens (RY-028) will be hashed the same way and exempt from CSRF because they are not ambient credentials.
- Rejected: option 1 exposes tokens to XSS and cannot be revoked before expiry; option 2 cannot be revoked and grows cookie size; option 4 adds an external dependency contrary to the self-contained goal (can be added later as an optional login method).
