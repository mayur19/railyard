import type { Queryable } from '../../db/pool.js';

export interface SessionRow {
  readonly id: string;
  readonly userId: string;
  readonly organizationId: string;
  readonly csrfToken: string;
  readonly expiresAt: Date;
}

export async function insertSession(
  db: Queryable,
  session: SessionRow & { userAgent: string | null; ip: string | null },
): Promise<void> {
  await db.query(
    `INSERT INTO sessions (id, user_id, organization_id, csrf_token, user_agent, ip, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      session.id,
      session.userId,
      session.organizationId,
      session.csrfToken,
      session.userAgent,
      session.ip,
      session.expiresAt,
    ],
  );
}

/** Loads a live session and touches last_seen_at in one round trip. */
export async function touchSession(db: Queryable, id: string): Promise<SessionRow | null> {
  const { rows } = await db.query<SessionRow>(
    `UPDATE sessions SET last_seen_at = now()
     WHERE id = $1 AND expires_at > now()
     RETURNING id, user_id AS "userId", organization_id AS "organizationId", csrf_token AS "csrfToken", expires_at AS "expiresAt"`,
    [id],
  );
  return rows[0] ?? null;
}

export async function deleteSession(db: Queryable, id: string): Promise<void> {
  await db.query('DELETE FROM sessions WHERE id = $1', [id]);
}

export async function deleteExpiredSessions(db: Queryable): Promise<number> {
  const result = await db.query('DELETE FROM sessions WHERE expires_at <= now()');
  return result.rowCount ?? 0;
}
