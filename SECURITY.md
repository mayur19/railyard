# Security Policy

## Supported versions

Railyard is pre-1.0. Only the latest commit on `main` receives security fixes.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's "Report a vulnerability" (Security
Advisories) on this repository. Do not open a public issue. Include reproduction steps, the
affected commit, and the impact you observed. You should receive an acknowledgement within
five working days.

## Important operational notes

- **Pipeline steps are untrusted code.** Runners execute shell steps as the runner's OS user
  without containers. Run runners under a dedicated unprivileged account on hosts that hold no
  other secrets. Stronger isolation is planned (RY-054, RY-058).
- Step environments are built from scratch; runner variables such as `DATABASE_URL` and
  `SESSION_SECRET` are never passed to scripts.
- Login throttling, the per-IP email fan-out cap and the registration limiter are in-memory per
  API process. Run a **single API instance** until shared counters land (RY-151).
- Set `TRUST_PROXY` explicitly (false, a hop count, or proxy IPs/CIDRs). Startup fails in
  production when it is unset; `true` is rejected.
- The secret store (AES-256-GCM, RY-070) is not implemented yet: do not put credentials in
  pipeline YAML.

See [docs/security/threat-model.md](docs/security/threat-model.md) for the full threat model.
