# ADR-0019: Explicit TRUST_PROXY configuration; `true` is never accepted

- Status: Accepted
- Date: 2026-11-24
- Tickets: RY-002, RY-021

## Context

Login throttling, registration limits, audit entries (`audit_logs.ip`) and session records (`sessions.ip`) all depend on the client IP. Behind nginx the socket address is the proxy, and the real client is in `X-Forwarded-For`. Fastify's `trustProxy: true` trusts every hop of that header, which lets any client forge its IP by sending its own `X-Forwarded-For`, defeating per-IP rate limits and poisoning audit records. Directly exposed deployments must trust nothing.

## Decision Drivers

- Rate limits keyed by IP must not be bypassable by a header.
- Safe default for direct exposure in development; an explicit choice in production.
- Support for the common topologies: direct, one local reverse proxy, a known set of proxy addresses.
- Misconfiguration fails at boot, not silently.

## Considered Options

1. `trustProxy: true` when behind a proxy.
2. Always use the socket address; ignore forwarding headers.
3. Explicit `TRUST_PROXY` env: `false` (default), a hop count, or a comma-separated list of proxy IPs/CIDRs; `true` rejected.

## Decision Outcome

Chosen option: **3**. `parseTrustProxy` in `config/env.ts` accepts `''`, `false`, `0` (trust nothing), an integer of one or two digits (trust that many hops; converted by `toFastifyTrustProxy` into `(address, hop) => hop < n`), or a list of IP/CIDR entries. Anything else, including `true`, fails configuration loading with a message naming the variable. With `NODE_ENV=production` the variable must be set explicitly (even to `false`); an unset `TRUST_PROXY` fails startup, so a proxied production deployment cannot silently key every client by the proxy address.

### Consequences

- Positive: with nginx on the same host, `TRUST_PROXY=1` yields the real client address while ignoring any forged entries to its left.
- Positive: direct exposure is safe by default in development, and production operators must state their topology.
- Positive: covered by `apps/api/test/unit.test.ts` ("parses TRUST_PROXY as false, hop count or address list and rejects true", "maps hop counts to a hop-limited trust function").
- Negative: operators must set the variable consciously; if it is set to `false` behind a proxy, all clients share the proxy's IP and hit the per-IP limits together. The runbook lists this symptom.
- Rejected: option 1 is a known header-spoofing vulnerability; option 2 breaks every proxied deployment's rate limiting and audit accuracy.
