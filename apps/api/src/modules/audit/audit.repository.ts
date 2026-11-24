import type { Queryable } from '../../db/pool.js';

export interface AuditEntry {
  readonly organizationId: string | null;
  readonly actorUserId: string | null;
  readonly action: string;
  readonly targetType?: string;
  readonly targetId?: string;
  readonly metadata?: Record<string, unknown>;
  readonly requestId?: string;
  readonly ip?: string;
}

/** Append-only audit trail. Called inside the same transaction as the audited change. */
export async function writeAudit(db: Queryable, entry: AuditEntry): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (organization_id, actor_user_id, action, target_type, target_id, metadata, request_id, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      entry.organizationId,
      entry.actorUserId,
      entry.action,
      entry.targetType ?? null,
      entry.targetId ?? null,
      JSON.stringify(entry.metadata ?? {}),
      entry.requestId ?? null,
      entry.ip ?? null,
    ],
  );
}
