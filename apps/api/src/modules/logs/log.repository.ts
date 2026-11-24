import type { Queryable } from '../../db/pool.js';

export type LogStream = 'stdout' | 'stderr' | 'system';

export interface LogChunk {
  readonly seq: number;
  readonly attempt: number;
  readonly stream: LogStream;
  readonly content: string;
  readonly createdAt: Date;
}

export async function insertChunks(
  db: Queryable,
  jobId: string,
  chunks: readonly { seq: number; attempt: number; stream: LogStream; content: string }[],
): Promise<void> {
  if (chunks.length === 0) return;
  await db.query(
    `INSERT INTO job_log_chunks (job_id, seq, attempt, stream, content)
     SELECT $1, x.seq, x.attempt, x.stream, x.content
     FROM jsonb_to_recordset($2::jsonb) AS x(seq int, attempt int, stream text, content text)`,
    [jobId, JSON.stringify(chunks)],
  );
}

export async function listChunks(
  db: Queryable,
  jobId: string,
  afterSeq: number,
  limit: number,
): Promise<LogChunk[]> {
  const { rows } = await db.query<LogChunk>(
    `SELECT seq, attempt, stream, content, created_at AS "createdAt"
     FROM job_log_chunks WHERE job_id = $1 AND seq > $2 ORDER BY seq LIMIT $3`,
    [jobId, afterSeq, limit],
  );
  return rows;
}

export async function maxSeq(db: Queryable, jobId: string): Promise<number> {
  const { rows } = await db.query<{ max: number | null }>(
    'SELECT max(seq) AS max FROM job_log_chunks WHERE job_id = $1',
    [jobId],
  );
  return rows[0]?.max ?? 0;
}
