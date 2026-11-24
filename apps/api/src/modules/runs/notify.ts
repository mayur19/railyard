import type { Queryable } from '../../db/pool.js';

export const LOG_CHANNEL = 'railyard_logs';
export const JOB_CHANNEL = 'railyard_jobs';

export interface LogNotification {
  readonly jobId: string;
  readonly seq: number;
}

export interface JobNotification {
  readonly runId: string;
  readonly jobId: string;
  readonly status: string;
}

/** NOTIFY is transactional: listeners only see it after COMMIT, never for rolled-back work. */
export async function notifyJob(db: Queryable, payload: JobNotification): Promise<void> {
  await db.query('SELECT pg_notify($1, $2)', [JOB_CHANNEL, JSON.stringify(payload)]);
}

export async function notifyLog(db: Queryable, payload: LogNotification): Promise<void> {
  await db.query('SELECT pg_notify($1, $2)', [LOG_CHANNEL, JSON.stringify(payload)]);
}
