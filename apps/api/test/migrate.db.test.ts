import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMigrations, migrate, MigrationError, resetSchema } from '../src/db/migrate.js';
import type { Pool } from '../src/db/pool.js';
import { seed } from '../src/db/seed.js';
import { freshDatabase } from './helpers.js';

let pool: Pool;
let dir: string;

beforeAll(async () => {
  pool = await freshDatabase();
  dir = await mkdtemp(path.join(os.tmpdir(), 'railyard-mig-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await pool.end();
});

describe('migration runner', () => {
  it('records the shipped migrations and is idempotent', async () => {
    const { rows } = await pool.query('SELECT name FROM schema_migrations ORDER BY version');
    expect(rows.map((r: { name: string }) => r.name)).toEqual([
      '0001_foundation.sql',
      '0002_projects_runs_jobs.sql',
    ]);
    expect(await migrate(pool)).toEqual([]);
  });

  it('detects edited migrations and bad file names', async () => {
    await resetSchema(pool, 'test');
    await writeFile(path.join(dir, '0001_a.sql'), 'CREATE TABLE t (id int);');
    expect(await migrate(pool, undefined, dir)).toEqual(['0001_a.sql']);
    await writeFile(path.join(dir, '0001_a.sql'), 'CREATE TABLE t (id bigint);');
    await expect(migrate(pool, undefined, dir)).rejects.toThrow(/checksum mismatch/);
    await writeFile(path.join(dir, 'oops.sql'), 'SELECT 1;');
    await expect(loadMigrations(dir)).rejects.toThrow(MigrationError);
  });

  it('rolls back a failing migration', async () => {
    const bad = await mkdtemp(path.join(os.tmpdir(), 'railyard-mig-bad-'));
    await resetSchema(pool, 'test');
    await writeFile(path.join(bad, '0001_ok.sql'), 'CREATE TABLE ok_t (id int);');
    await writeFile(path.join(bad, '0002_bad.sql'), 'CREATE TABLE half (id int); SELECT nope();');
    await expect(migrate(pool, undefined, bad)).rejects.toThrow(/0002_bad.sql failed/);
    const half = await pool.query("SELECT to_regclass('half') AS t");
    expect(half.rows[0].t).toBeNull();
    await rm(bad, { recursive: true, force: true });
  });

  it('refuses to reset in production', async () => {
    await expect(resetSchema(pool, 'production')).rejects.toThrow(/refusing/);
  });

  it('seeds demo data once', async () => {
    await resetSchema(pool, 'test');
    await migrate(pool);
    expect(await seed(pool)).toBe(true);
    expect(await seed(pool)).toBe(false);
    const runs = await pool.query('SELECT status FROM pipeline_runs ORDER BY created_at');
    expect(runs.rows.map((r: { status: string }) => r.status)).toEqual(['succeeded', 'queued']);
  });
});
