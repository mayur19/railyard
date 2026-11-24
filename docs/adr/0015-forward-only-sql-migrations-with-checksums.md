# ADR-0015: Forward-only SQL migrations with checksums and an advisory lock

- Status: Accepted
- Date: 2026-11-24
- Tickets: RY-003; RY-145 (upgrade and rollback playbooks)

## Context

Operators upgrade self-hosted installations themselves, sometimes skipping versions. The schema uses Postgres features directly (partial indexes, CHECK constraints, `inet`, `jsonb`, identity columns, `gen_random_uuid()`), which ORMs and schema DSLs model poorly. Two API processes started together must not apply the same migration twice. An applied migration that is later edited silently diverges databases.

## Decision Drivers

- Plain SQL, reviewed as SQL.
- Deterministic order; safe concurrent startup.
- Detect edits to already-applied migrations.
- Each migration atomic.
- Rollback strategy that works for operators without a DBA.

## Considered Options

1. ORM migrations (Prisma, TypeORM, Knex) with framework-produced up/down scripts.
2. Up/down SQL pairs with a down-migration tool.
3. Forward-only numbered SQL files with SHA-256 checksums recorded in `schema_migrations`, each in its own transaction, under `pg_advisory_lock`.

## Decision Outcome

Chosen option: **3**, `apps/api/src/db/migrate.ts`.

- Files match `^\d{4}_[a-z0-9_]+\.sql$` in `apps/api/migrations`; duplicate version numbers are an error.
- The migrator takes `pg_advisory_lock(41050001)`, creates `schema_migrations(version, name, checksum, applied_at)` if missing, and for each file in order either verifies the recorded checksum (mismatch is a hard error: "checksum mismatch for applied migration") or applies it inside `BEGIN ... COMMIT` and records it.
- The API applies pending migrations at boot (`index.ts`); `npm run db:migrate` runs them explicitly. `db:reset` refuses to run when `NODE_ENV=production`.
- Rollback is "restore the pre-upgrade `pg_dump` and redeploy the previous release" or "ship a new forward migration that reverses the change"; playbooks are RY-145, backup tooling RY-140.

### Consequences

- Positive: SQL is the source of truth; every Postgres feature is available; reviewing a migration is reviewing exactly what will run.
- Positive: concurrent boots serialise on the advisory lock; a failed migration rolls back cleanly and leaves the version unrecorded.
- Negative: no automatic down migrations; destructive changes need expand/contract across two releases.
- Negative: `CREATE INDEX CONCURRENTLY` cannot run inside a transaction; large-table index builds will need a documented exception (a migration marked non-transactional) when tables grow, tracked with RY-145.
- Rejected: option 1 adds a heavy dependency and a second schema language; option 2 creates untested down scripts that give false confidence.
