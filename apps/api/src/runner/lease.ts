import type { Pool, Queryable } from '../db/pool.js';
import { notifyJob } from '../modules/runs/notify.js';
import { completeJob } from '../modules/runs/run-progress.js';
import { withTransaction } from '../db/pool.js';

export interface LeasedStep {
  readonly id: string;
  readonly position: number;
  readonly name: string;
  readonly script: string;
  readonly env: Record<string, string>;
  readonly timeoutSeconds: number;
  readonly continueOnError: boolean;
  readonly workingDirectory: string | null;
}

export interface LeasedJob {
  readonly id: string;
  readonly runId: string;
  readonly key: string;
  readonly name: string;
  readonly attempt: number;
  readonly timeoutSeconds: number;
  readonly env: Record<string, string>;
  readonly steps: LeasedStep[];
}

export async function registerRunner(
  db: Queryable,
  runner: { name: string; hostname: string; labels: string[]; version: string },
): Promise<void> {
  await db.query(
    `INSERT INTO runners (name, hostname, labels, version, status, last_heartbeat_at)
     VALUES ($1, $2, $3, $4, 'online', now())
     ON CONFLICT (name) DO UPDATE SET hostname = EXCLUDED.hostname, labels = EXCLUDED.labels,
       version = EXCLUDED.version, status = 'online', last_heartbeat_at = now()`,
    [runner.name, runner.hostname, runner.labels, runner.version],
  );
}

export async function markRunner(
  db: Queryable,
  name: string,
  status: 'online' | 'offline',
): Promise<void> {
  await db.query('UPDATE runners SET status = $2, last_heartbeat_at = now() WHERE name = $1', [
    name,
    status,
  ]);
}

/**
 * Claims the oldest queued job. FOR UPDATE SKIP LOCKED lets any number of runners poll the same
 * table concurrently without blocking each other or double-claiming: rows locked by another
 * claimer are skipped rather than waited on. The run is flipped to running in the same transaction.
 */
export async function leaseNextJob(
  pool: Pool,
  owner: string,
  leaseSeconds: number,
): Promise<LeasedJob | null> {
  return withTransaction(pool, async (tx) => {
    const { rows } = await tx.query<Omit<LeasedJob, 'steps'>>(
      `WITH next AS (
         SELECT id FROM jobs WHERE status = 'queued' ORDER BY queued_at, id FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE jobs j SET status = 'running', attempt = j.attempt + 1, lease_owner = $1,
              lease_expires_at = clock_timestamp() + make_interval(secs => $2),
              started_at = coalesce(j.started_at, clock_timestamp()), exit_code = NULL, failure_reason = NULL
       FROM next WHERE j.id = next.id
       RETURNING j.id, j.run_id AS "runId", j.key, j.name, j.attempt, j.timeout_seconds AS "timeoutSeconds", j.env`,
      [owner, leaseSeconds],
    );
    const job = rows[0];
    if (!job) return null;
    await tx.query(
      `UPDATE pipeline_runs SET status = 'running', started_at = coalesce(started_at, clock_timestamp())
       WHERE id = $1 AND status = 'queued'`,
      [job.runId],
    );
    await notifyJob(tx, { runId: job.runId, jobId: job.id, status: 'running' });
    const steps = await tx.query<LeasedStep>(
      `SELECT id, position, name, script, env, timeout_seconds AS "timeoutSeconds",
              continue_on_error AS "continueOnError", working_directory AS "workingDirectory"
       FROM job_steps WHERE job_id = $1 ORDER BY position`,
      [job.id],
    );
    return { ...job, steps: steps.rows };
  });
}

/** Extends the lease; false means the lease was lost (reaped or cancelled) and work must stop. */
export async function extendLease(
  db: Queryable,
  jobId: string,
  owner: string,
  leaseSeconds: number,
): Promise<boolean> {
  const result = await db.query(
    `UPDATE jobs SET lease_expires_at = clock_timestamp() + make_interval(secs => $3)
     WHERE id = $1 AND lease_owner = $2 AND status = 'running'`,
    [jobId, owner, leaseSeconds],
  );
  return (result.rowCount ?? 0) === 1;
}

/**
 * Settles jobs whose lease expired (runner crashed or was partitioned). Each expired attempt is
 * treated as a failure, so the normal retry policy decides between requeue and failure.
 */
export async function reapExpiredLeases(pool: Pool, limit = 100): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM jobs WHERE status = 'running' AND lease_expires_at < clock_timestamp()
     ORDER BY lease_expires_at LIMIT $1`,
    [limit],
  );
  let reaped = 0;
  for (const row of rows) {
    const outcome = await completeJob(pool, {
      jobId: row.id,
      leaseOwner: null,
      result: 'failed',
      exitCode: null,
      reason: 'lease expired (runner lost)',
    });
    if (outcome.applied) reaped += 1;
  }
  return reaped;
}

/**
 * Step updates are fenced by the lease: they only apply while `owner` still holds the running
 * job, so a runner that lost its lease cannot overwrite steps of a requeued attempt.
 * Returns false when the lease is no longer held.
 */
export async function markStepStarted(
  db: Queryable,
  stepId: string,
  owner: string,
): Promise<boolean> {
  const result = await db.query(
    `UPDATE job_steps s SET status = 'running', started_at = clock_timestamp()
     FROM jobs j WHERE s.id = $1 AND j.id = s.job_id AND j.lease_owner = $2 AND j.status = 'running'`,
    [stepId, owner],
  );
  return (result.rowCount ?? 0) === 1;
}

export async function markStepFinished(
  db: Queryable,
  stepId: string,
  owner: string,
  status: 'succeeded' | 'failed' | 'timed_out' | 'skipped' | 'cancelled',
  exitCode: number | null,
): Promise<boolean> {
  const result = await db.query(
    `UPDATE job_steps s SET status = $3, exit_code = $4, finished_at = clock_timestamp()
     FROM jobs j WHERE s.id = $1 AND j.id = s.job_id AND j.lease_owner = $2 AND j.status = 'running'`,
    [stepId, owner, status, exitCode],
  );
  return (result.rowCount ?? 0) === 1;
}
