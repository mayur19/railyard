import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from '../src/db/pool.js';
import { extendLease, leaseNextJob, reapExpiredLeases } from '../src/runner/lease.js';
import { Runner } from '../src/runner/runner.js';
import { completeJob } from '../src/modules/runs/run-progress.js';
import {
  createProject,
  createRunVia,
  freshDatabase,
  register,
  silentLogger,
  testApp,
  testConfig,
  type Session,
} from './helpers.js';

let pool: Pool;
let app: FastifyInstance;
let session: Session;
let projectId: string;

beforeAll(async () => {
  pool = await freshDatabase();
  app = await testApp(pool);
  session = await register(app);
  projectId = await createProject(app, session);
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

function makeRunner(name = 'test-runner') {
  return new Runner({ pool, logger: silentLogger, config: testConfig(), name });
}

async function drain(runner: Runner, max = 50): Promise<number> {
  let ran = 0;
  while (ran < max && (await runner.runOnce())) ran += 1;
  return ran;
}

async function startRun(yaml: string, branch = 'main'): Promise<string> {
  // Isolate each scenario: settle anything left queued by earlier tests.
  await pool.query(
    "UPDATE jobs SET status = 'cancelled', finished_at = now() WHERE status IN ('queued', 'blocked')",
  );
  const res = await createRunVia(app, session, projectId, yaml, branch);
  if (res.statusCode !== 201) throw new Error(res.body);
  return res.json().data.id as string;
}

async function runState(runId: string) {
  const run = await pool.query('SELECT status FROM pipeline_runs WHERE id = $1', [runId]);
  const jobs = await pool.query<{ key: string; status: string; attempt: number }>(
    'SELECT key, status, attempt FROM jobs WHERE run_id = $1 ORDER BY key',
    [runId],
  );
  return {
    status: run.rows[0].status as string,
    jobs: Object.fromEntries(jobs.rows.map((j) => [j.key, j.status])),
    rows: jobs.rows,
  };
}

async function logsOf(runId: string, key: string): Promise<string> {
  const { rows } = await pool.query<{ content: string }>(
    `SELECT c.content FROM job_log_chunks c JOIN jobs j ON j.id = c.job_id WHERE j.run_id = $1 AND j.key = $2 ORDER BY c.seq`,
    [runId, key],
  );
  return rows.map((r) => r.content).join('');
}

describe('runner end to end', () => {
  it('executes a DAG with a matrix in dependency order and records logs', async () => {
    const runId = await startRun(`name: e2e
stages: [build, test, report]
jobs:
  build:
    stage: build
    steps:
      - name: make artifact
        run: echo "built on $RAILYARD_BRANCH" > out.txt && cat out.txt
  test:
    stage: test
    matrix:
      n: [1, 2]
    steps:
      - run: echo "shard \${{ matrix.n }} of $MATRIX_N"
  report:
    stage: report
    steps:
      - run: ls
`);
    const runner = makeRunner();
    await runner.register();
    expect(await drain(runner)).toBe(4);
    const state = await runState(runId);
    expect(state.status).toBe('succeeded');
    expect(Object.values(state.jobs)).toEqual(['succeeded', 'succeeded', 'succeeded', 'succeeded']);
    expect(await logsOf(runId, 'build')).toContain('built on main');
    expect(await logsOf(runId, 'test[n=2]')).toContain('shard 2 of 2');
    const order = await pool.query<{ key: string }>(
      'SELECT key FROM jobs WHERE run_id = $1 ORDER BY started_at',
      [runId],
    );
    expect(order.rows[0]?.key).toBe('build');
    expect(order.rows[3]?.key).toBe('report');
    const steps = await pool.query(
      'SELECT s.status, s.exit_code FROM job_steps s JOIN jobs j ON j.id = s.job_id WHERE j.run_id = $1',
      [runId],
    );
    expect(steps.rows.every((s: { status: string }) => s.status === 'succeeded')).toBe(true);
  });

  it('skips dependents of a failure and runs on_failure / always jobs', async () => {
    const runId = await startRun(`name: failing
jobs:
  broken:
    steps:
      - run: echo before; exit 7
      - run: echo never
  downstream:
    needs: [broken]
    steps: [echo nope]
  later:
    needs: [downstream]
    steps: [echo nope]
  alert:
    needs: [later]
    when: on_failure
    steps: [echo alerting]
  cleanup:
    needs: [broken]
    when: always
    steps: [echo cleaning]
`);
    await drain(makeRunner());
    const state = await runState(runId);
    expect(state.jobs).toEqual({
      alert: 'succeeded',
      broken: 'failed',
      cleanup: 'succeeded',
      downstream: 'skipped',
      later: 'skipped',
    });
    expect(state.status).toBe('failed');
    const broken = await pool.query(
      "SELECT exit_code, failure_reason FROM jobs WHERE run_id = $1 AND key = 'broken'",
      [runId],
    );
    expect(broken.rows[0]).toMatchObject({ exit_code: 7 });
    const steps = await pool.query(
      "SELECT s.status FROM job_steps s JOIN jobs j ON j.id = s.job_id WHERE j.run_id = $1 AND j.key = 'broken' ORDER BY position",
      [runId],
    );
    expect(steps.rows.map((s: { status: string }) => s.status)).toEqual(['failed', 'skipped']);
    expect(await logsOf(runId, 'broken')).not.toContain('never');
  });

  it('honours allow-failure and continue-on-error', async () => {
    const runId = await startRun(`name: tolerant
jobs:
  flaky:
    allow-failure: true
    steps: [exit 1]
  lenient:
    steps:
      - run: exit 2
        continue-on-error: true
      - echo still running
  after:
    needs: [flaky, lenient]
    steps: [echo done]
`);
    await drain(makeRunner());
    const state = await runState(runId);
    expect(state.jobs).toEqual({ after: 'succeeded', flaky: 'failed', lenient: 'succeeded' });
    expect(state.status).toBe('succeeded');
    expect(await logsOf(runId, 'lenient')).toContain('still running');
  });

  it('retries failed attempts and keeps log sequence across attempts', async () => {
    const runId = await startRun(`name: retry
jobs:
  flaky:
    retries: 2
    steps: [echo attempt; exit 1]
`);
    await drain(makeRunner());
    const state = await runState(runId);
    expect(state.rows[0]).toMatchObject({ status: 'failed', attempt: 3 });
    const seqs = await pool.query<{ seq: number; attempt: number }>(
      'SELECT c.seq, c.attempt FROM job_log_chunks c JOIN jobs j ON j.id = c.job_id WHERE j.run_id = $1 ORDER BY seq',
      [runId],
    );
    expect(new Set(seqs.rows.map((r) => r.attempt))).toEqual(new Set([1, 2, 3]));
    expect(seqs.rows.map((r) => r.seq)).toEqual(seqs.rows.map((_, i) => i + 1));
  });

  it('masks nothing it should not and truncates nothing small', async () => {
    const runId = await startRun(`name: ansi
jobs:
  colour:
    steps:
      - printf '\\033[31mred\\033[0m\\n'
`);
    await drain(makeRunner());
    expect(await logsOf(runId, 'colour')).toContain('\u001b[31mred');
  });
});

describe('leasing', () => {
  it('never hands the same job to two concurrent runners (SKIP LOCKED)', async () => {
    await startRun(`name: wide
jobs:
${Array.from({ length: 12 }, (_, i) => `  j${i}:\n    steps: [echo ${i}]\n`).join('')}`);
    const claims = await Promise.all(
      Array.from({ length: 16 }, (_, i) => leaseNextJob(pool, `racer-${i}`, 30)),
    );
    const ids = claims.filter((c) => c !== null).map((c) => c?.id);
    expect(ids).toHaveLength(12);
    expect(new Set(ids).size).toBe(12);
    expect(claims.filter((c) => c === null)).toHaveLength(4);
    const run = await pool.query(
      'SELECT DISTINCT r.status FROM pipeline_runs r JOIN jobs j ON j.run_id = r.id WHERE j.id = ANY($1)',
      [ids],
    );
    expect(run.rows).toEqual([{ status: 'running' }]);
  });

  it('extends leases only for the owner and reaps expired leases with retry policy', async () => {
    const runId = await startRun(`name: crash
jobs:
  once:
    steps: [echo hi]
  twice:
    retries: 1
    steps: [echo hi]
`);
    const a = await leaseNextJob(pool, 'crashy', 30);
    const b = await leaseNextJob(pool, 'crashy', 30);
    expect(await extendLease(pool, a?.id as string, 'someone-else', 30)).toBe(false);
    expect(await extendLease(pool, a?.id as string, 'crashy', 30)).toBe(true);
    await pool.query(
      "UPDATE jobs SET lease_expires_at = now() - interval '1 second' WHERE run_id = $1",
      [runId],
    );
    expect(await reapExpiredLeases(pool)).toBe(2);
    const state = await runState(runId);
    expect(state.jobs).toEqual({ once: 'failed', twice: 'queued' });
    const reason = await pool.query('SELECT failure_reason FROM jobs WHERE id = $1', [
      a?.key === 'once' ? a.id : b?.id,
    ]);
    expect(reason.rows[0].failure_reason).toMatch(/lease expired/);
    // A late completion from the crashed runner is ignored.
    const late = await completeJob(pool, {
      jobId: a?.id as string,
      leaseOwner: 'crashy',
      result: 'succeeded',
      exitCode: 0,
      reason: null,
    });
    expect(late.applied).toBe(false);
  });

  it('fails a job that exceeds its timeout', async () => {
    const runId = await startRun(`name: slow
jobs:
  slow:
    steps: [sleep 20]
`);
    await pool.query('UPDATE jobs SET timeout_seconds = 1 WHERE run_id = $1', [runId]);
    await drain(makeRunner());
    const job = await pool.query('SELECT status, failure_reason FROM jobs WHERE run_id = $1', [
      runId,
    ]);
    expect(job.rows[0]).toMatchObject({ status: 'timed_out', failure_reason: 'job timeout' });
  });

  it('stops work and discards results when the lease is lost', async () => {
    const runId = await startRun(`name: stolen
jobs:
  long:
    steps: [sleep 20]
`);
    const runner = new Runner({
      pool,
      logger: silentLogger,
      config: { ...testConfig(), RUNNER_LEASE_SECONDS: 5 },
      name: 'victim',
    });
    const work = runner.runOnce();
    await new Promise((r) => setTimeout(r, 500));
    // Simulate the reaper or a cancellation taking the job away.
    await pool.query("UPDATE jobs SET status = 'queued', lease_owner = NULL WHERE run_id = $1", [
      runId,
    ]);
    await work;
    const job = await pool.query('SELECT status FROM jobs WHERE run_id = $1', [runId]);
    expect(job.rows[0].status).toBe('queued');
  }, 20_000);

  it('runs a background loop and stops cleanly', async () => {
    const runId = await startRun(`name: loop
jobs:
  quick:
    steps: [echo loop]
`);
    const runner = makeRunner('looper');
    runner.start();
    for (let i = 0; i < 100; i += 1) {
      if ((await runState(runId)).status === 'succeeded') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    await runner.stop();
    expect((await runState(runId)).status).toBe('succeeded');
    const status = await pool.query("SELECT status FROM runners WHERE name = 'looper'");
    expect(status.rows[0].status).toBe('offline');
  });
});
