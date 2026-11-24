import {
  deriveRunStatus,
  isTerminal,
  outcomeAfterAttempt,
  resolveBlockedJobs,
  type JobStatus,
  type JobWhen,
  type RunStatus,
  type SchedulableJob,
} from '@railyard/shared';
import { withTransaction, type Pool, type PoolClient } from '../../db/pool.js';
import { notifyJob } from './notify.js';

export type AttemptResult = 'succeeded' | 'failed' | 'timed_out' | 'cancelled';

export interface CompletionInput {
  readonly jobId: string;
  /** Lease owner that must still hold the job; null for system actors such as the reaper. */
  readonly leaseOwner: string | null;
  readonly result: AttemptResult;
  readonly exitCode: number | null;
  readonly reason: string | null;
}

export interface CompletionOutcome {
  readonly applied: boolean;
  readonly retried: boolean;
  readonly runStatus: RunStatus | null;
  readonly promoted: readonly { key: string; status: JobStatus }[];
}

const NOT_APPLIED: CompletionOutcome = {
  applied: false,
  retried: false,
  runStatus: null,
  promoted: [],
};

/**
 * Settles one job attempt and advances the run, atomically:
 *   lock run row -> verify lease -> settle or requeue (retry) -> resolve blocked dependents
 *   -> derive run status -> NOTIFY.
 * Locking the run row serialises completions within a run so two jobs finishing at the same
 * time cannot both miss promoting a shared dependent.
 */
export async function completeJob(pool: Pool, input: CompletionInput): Promise<CompletionOutcome> {
  return withTransaction(pool, async (tx) => {
    const runId = await lockRunOfJob(tx, input.jobId);
    if (!runId) return NOT_APPLIED;
    const { rows } = await tx.query<{
      status: JobStatus;
      attempt: number;
      retries: number;
      leaseOwner: string | null;
    }>(
      `SELECT status, attempt, retries, lease_owner AS "leaseOwner" FROM jobs WHERE id = $1 FOR UPDATE`,
      [input.jobId],
    );
    const job = rows[0];
    if (!job || job.status !== 'running') return NOT_APPLIED;
    if (input.leaseOwner !== null && job.leaseOwner !== input.leaseOwner) return NOT_APPLIED;

    const outcome = outcomeAfterAttempt(input.result, job.attempt, job.retries);
    if (outcome.retry) await requeueForRetry(tx, input);
    else await settle(tx, input);
    await notifyJob(tx, { runId, jobId: input.jobId, status: outcome.status });

    const { promoted, runStatus } = await advanceRun(tx, runId);
    return { applied: true, retried: outcome.retry, runStatus, promoted };
  });
}

async function lockRunOfJob(tx: PoolClient, jobId: string): Promise<string | null> {
  const { rows } = await tx.query<{ id: string }>(
    `SELECT r.id FROM pipeline_runs r JOIN jobs j ON j.run_id = r.id WHERE j.id = $1 FOR UPDATE OF r`,
    [jobId],
  );
  return rows[0]?.id ?? null;
}

async function requeueForRetry(tx: PoolClient, input: CompletionInput): Promise<void> {
  await tx.query(
    `UPDATE jobs SET status = 'queued', lease_owner = NULL, lease_expires_at = NULL, queued_at = clock_timestamp(),
            exit_code = $2, failure_reason = $3
     WHERE id = $1`,
    [input.jobId, input.exitCode, input.reason],
  );
  await tx.query(
    `UPDATE job_steps SET status = 'pending', exit_code = NULL, started_at = NULL, finished_at = NULL WHERE job_id = $1`,
    [input.jobId],
  );
}

async function settle(tx: PoolClient, input: CompletionInput): Promise<void> {
  await tx.query(
    `UPDATE jobs SET status = $2, lease_owner = NULL, lease_expires_at = NULL, finished_at = clock_timestamp(),
            exit_code = $3, failure_reason = $4
     WHERE id = $1`,
    [input.jobId, input.result, input.exitCode, input.reason],
  );
  // Steps the executor never reached (or abandoned because the lease was lost) are closed out.
  await tx.query(
    `UPDATE job_steps SET status = CASE WHEN status = 'running' THEN $2 ELSE 'skipped' END,
            finished_at = coalesce(finished_at, clock_timestamp())
     WHERE job_id = $1 AND status IN ('pending', 'running')`,
    [
      input.jobId,
      input.result === 'succeeded'
        ? 'succeeded'
        : input.result === 'cancelled'
          ? 'cancelled'
          : 'failed',
    ],
  );
}

/** Applies dependency resolution and recomputes the run status. Caller must hold the run lock. */
export async function advanceRun(
  tx: PoolClient,
  runId: string,
): Promise<{ promoted: { key: string; status: JobStatus }[]; runStatus: RunStatus }> {
  const { rows } = await tx.query<SchedulableJob & { id: string }>(
    `SELECT id, key, status, needs, run_when AS "when", allow_failure AS "allowFailure" FROM jobs WHERE run_id = $1`,
    [runId],
  );
  const changes = resolveBlockedJobs(rows.map((row) => ({ ...row, when: row.when as JobWhen })));
  const byTarget = new Map<JobStatus, string[]>();
  for (const change of changes)
    byTarget.set(change.to, [...(byTarget.get(change.to) ?? []), change.key]);
  for (const [status, keys] of byTarget) {
    const updated = await tx.query<{ id: string }>(
      `UPDATE jobs SET status = $3,
              queued_at = CASE WHEN $3 = 'queued' THEN clock_timestamp() ELSE queued_at END,
              finished_at = CASE WHEN $3 IN ('skipped', 'cancelled') THEN clock_timestamp() ELSE finished_at END
       WHERE run_id = $1 AND key = ANY($2) AND status = 'blocked' RETURNING id`,
      [runId, keys, status],
    );
    if (isTerminal(status)) {
      await tx.query(
        `UPDATE job_steps SET status = 'skipped' WHERE job_id = ANY($1) AND status = 'pending'`,
        [updated.rows.map((row) => row.id)],
      );
    }
    for (const row of updated.rows) await notifyJob(tx, { runId, jobId: row.id, status });
  }
  const finalStatuses = new Map(rows.map((row) => [row.key, row.status]));
  for (const change of changes) finalStatuses.set(change.key, change.to);
  const runStatus = deriveRunStatus(
    rows.map((row) => ({
      status: finalStatuses.get(row.key) as JobStatus,
      allowFailure: row.allowFailure,
    })),
  );
  await tx.query(
    `UPDATE pipeline_runs SET status = $2,
            started_at = CASE WHEN $2 <> 'queued' THEN coalesce(started_at, clock_timestamp()) ELSE started_at END,
            finished_at = CASE WHEN $2 IN ('succeeded', 'failed', 'cancelled') THEN clock_timestamp() ELSE NULL END
     WHERE id = $1`,
    [runId, runStatus],
  );
  return { promoted: changes.map((c) => ({ key: c.key, status: c.to })), runStatus };
}
