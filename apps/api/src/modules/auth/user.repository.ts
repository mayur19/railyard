import type { Role } from '@railyard/shared';
import type { Queryable } from '../../db/pool.js';

export interface UserWithMembership {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly passwordHash: string;
  readonly disabled: boolean;
  readonly organizationId: string;
  readonly organizationName: string;
  readonly organizationSlug: string;
  readonly role: Role;
}

const SELECT_USER = `
  SELECT u.id, u.email, u.name, u.password_hash AS "passwordHash", u.disabled_at IS NOT NULL AS disabled,
         o.id AS "organizationId", o.name AS "organizationName", o.slug AS "organizationSlug", m.role
  FROM users u
  JOIN memberships m ON m.user_id = u.id
  JOIN organizations o ON o.id = m.organization_id`;

/** First membership by creation date; multi-organization switching is tracked as RY-146. */
export async function findUserByEmail(
  db: Queryable,
  email: string,
): Promise<UserWithMembership | null> {
  const { rows } = await db.query<UserWithMembership>(
    `${SELECT_USER} WHERE lower(u.email) = lower($1) ORDER BY m.created_at LIMIT 1`,
    [email],
  );
  return rows[0] ?? null;
}

export async function findUserInOrganization(
  db: Queryable,
  userId: string,
  organizationId: string,
): Promise<UserWithMembership | null> {
  const { rows } = await db.query<UserWithMembership>(
    `${SELECT_USER} WHERE u.id = $1 AND o.id = $2`,
    [userId, organizationId],
  );
  return rows[0] ?? null;
}

export async function insertOrganization(
  db: Queryable,
  name: string,
  slug: string,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    'INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id',
    [name, slug],
  );
  return (rows[0] as { id: string }).id;
}

export async function insertUser(
  db: Queryable,
  email: string,
  name: string,
  passwordHash: string,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    'INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id',
    [email, name, passwordHash],
  );
  return (rows[0] as { id: string }).id;
}

export async function insertMembership(
  db: Queryable,
  organizationId: string,
  userId: string,
  role: Role,
): Promise<void> {
  await db.query('INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, $3)', [
    organizationId,
    userId,
    role,
  ]);
}
