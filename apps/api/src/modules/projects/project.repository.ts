import type { CreateProjectInput } from '@railyard/shared';
import type { Queryable } from '../../db/pool.js';

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly repositoryPath: string;
  readonly defaultBranch: string;
  readonly createdAt: Date;
  readonly lastRun: {
    readonly number: number;
    readonly status: string;
    readonly createdAt: Date;
  } | null;
}

const SELECT_PROJECT = `
  SELECT p.id, p.name, p.slug, p.repository_path AS "repositoryPath", p.default_branch AS "defaultBranch",
         p.created_at AS "createdAt",
         (SELECT json_build_object('number', r.number, 'status', r.status, 'createdAt', r.created_at)
            FROM pipeline_runs r WHERE r.project_id = p.id ORDER BY r.number DESC LIMIT 1) AS "lastRun"
  FROM projects p`;

/** Every query is scoped by organization_id: tenant isolation is enforced here, not in routes. */
export async function listProjects(db: Queryable, organizationId: string): Promise<Project[]> {
  const { rows } = await db.query<Project>(
    `${SELECT_PROJECT} WHERE p.organization_id = $1 ORDER BY p.name`,
    [organizationId],
  );
  return rows;
}

export async function findProject(
  db: Queryable,
  organizationId: string,
  id: string,
): Promise<Project | null> {
  const { rows } = await db.query<Project>(
    `${SELECT_PROJECT} WHERE p.organization_id = $1 AND p.id = $2`,
    [organizationId, id],
  );
  return rows[0] ?? null;
}

export async function insertProject(
  db: Queryable,
  organizationId: string,
  userId: string,
  input: CreateProjectInput,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO projects (organization_id, name, slug, repository_path, default_branch, created_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [organizationId, input.name, input.slug, input.repositoryPath, input.defaultBranch, userId],
  );
  return (rows[0] as { id: string }).id;
}

/** Atomically reserves the next run number for a project (row lock serialises concurrent runs). */
export async function reserveRunNumber(
  db: Queryable,
  organizationId: string,
  projectId: string,
): Promise<number | null> {
  const { rows } = await db.query<{ number: number }>(
    `UPDATE projects SET next_run_number = next_run_number + 1, updated_at = now()
     WHERE id = $1 AND organization_id = $2
     RETURNING next_run_number - 1 AS number`,
    [projectId, organizationId],
  );
  return rows[0]?.number ?? null;
}
