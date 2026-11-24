import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Logger } from 'pino';
import type { Pool } from './pool.js';

// Works from src/db/migrate.ts, dist/db/cli.js (../../migrations) and the bundled dist/index.js (../migrations).
export const DEFAULT_MIGRATIONS_DIR =
  ['../../migrations', '../migrations']
    .map((rel) => fileURLToPath(new URL(rel, import.meta.url)))
    .find((dir) => existsSync(path.join(dir, '0001_foundation.sql'))) ??
  fileURLToPath(new URL('../../migrations', import.meta.url));
const FILE_PATTERN = /^(\d{4})_[a-z0-9_]+\.sql$/;
// Arbitrary constant so concurrent migrators (two API boots) serialise.
const MIGRATION_LOCK_KEY = 4105_0001;

export interface Migration {
  readonly version: string;
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

export async function loadMigrations(dir: string = DEFAULT_MIGRATIONS_DIR): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort();
  const migrations: Migration[] = [];
  for (const file of files) {
    const match = FILE_PATTERN.exec(file);
    if (!match) throw new MigrationError(`invalid migration file name: ${file}`);
    const sql = await readFile(path.join(dir, file), 'utf8');
    migrations.push({
      version: match[1] as string,
      name: file,
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    });
  }
  const versions = new Set(migrations.map((m) => m.version));
  if (versions.size !== migrations.length) throw new MigrationError('duplicate migration version');
  return migrations;
}

/**
 * Applies pending migrations in order, each in its own transaction, under an advisory lock.
 * Already-applied migrations are verified against their recorded checksum (forward-only:
 * editing an applied file is an error).
 */
export async function migrate(pool: Pool, logger?: Logger, dir?: string): Promise<string[]> {
  const migrations = await loadMigrations(dir);
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      name text NOT NULL,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const { rows } = await client.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM schema_migrations',
    );
    const recorded = new Map(rows.map((row) => [row.version, row.checksum]));
    for (const migration of migrations) {
      const checksum = recorded.get(migration.version);
      if (checksum !== undefined) {
        if (checksum !== migration.checksum) {
          throw new MigrationError(`checksum mismatch for applied migration ${migration.name}`);
        }
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
          [migration.version, migration.name, migration.checksum],
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new MigrationError(`migration ${migration.name} failed: ${(err as Error).message}`);
      }
      applied.push(migration.name);
      logger?.info({ migration: migration.name }, 'applied migration');
    }
  } finally {
    await client
      .query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY])
      .catch(() => undefined);
    client.release();
  }
  return applied;
}

/** Drops and recreates the public schema. Refuses to run in production. */
export async function resetSchema(pool: Pool, nodeEnv: string): Promise<void> {
  if (nodeEnv === 'production')
    throw new MigrationError('refusing to reset the schema in production');
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
}
