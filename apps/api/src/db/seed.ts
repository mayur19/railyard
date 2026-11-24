import type { Logger } from 'pino';
import { compilePlan, validatePipelineYaml, type RunContext } from '@railyard/shared';
import { withTransaction, type Pool, type PoolClient } from './pool.js';
import { hashPassword } from '../security/password.js';
import {
  insertMembership,
  insertOrganization,
  insertUser,
} from '../modules/auth/user.repository.js';
import { insertProject, reserveRunNumber } from '../modules/projects/project.repository.js';
import { insertRun } from '../modules/runs/run.repository.js';
import { PAYMENTS_PIPELINE, STOREFRONT_PIPELINE } from './sample-pipelines.js';

export const DEMO_PASSWORD = 'railyard-demo-pass';
export const DEMO_USERS = [
  { email: 'owner@railyard.local', name: 'Olivia Owner', role: 'owner' },
  { email: 'dev@railyard.local', name: 'Dev Patel', role: 'developer' },
  { email: 'viewer@railyard.local', name: 'Vik Viewer', role: 'viewer' },
] as const;

/** Idempotent: does nothing when the demo organization already exists. */
export async function seed(pool: Pool, logger?: Logger): Promise<boolean> {
  const existing = await pool.query("SELECT 1 FROM organizations WHERE slug = 'acme-rail'");
  if ((existing.rowCount ?? 0) > 0) {
    logger?.info('demo data already present');
    return false;
  }
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  await withTransaction(pool, async (tx) => {
    const orgId = await insertOrganization(tx, 'Acme Rail', 'acme-rail');
    const userIds: string[] = [];
    for (const user of DEMO_USERS) {
      const id = await insertUser(tx, user.email, user.name, passwordHash);
      await insertMembership(tx, orgId, id, user.role);
      userIds.push(id);
    }
    const owner = userIds[0] as string;
    const storefront = await insertProject(tx, orgId, owner, {
      name: 'Storefront',
      slug: 'storefront',
      repositoryPath: '/srv/git/storefront.git',
      defaultBranch: 'main',
    });
    const payments = await insertProject(tx, orgId, owner, {
      name: 'Payments API',
      slug: 'payments-api',
      repositoryPath: '/srv/git/payments-api.git',
      defaultBranch: 'main',
    });
    await seedHistoricalRun(tx, orgId, payments, owner);
    await seedQueuedRun(tx, orgId, storefront, owner, STOREFRONT_PIPELINE, 'main');
  });
  logger?.info('seeded demo organization acme-rail');
  return true;
}

async function planRun(
  tx: PoolClient,
  orgId: string,
  projectId: string,
  userId: string,
  yaml: string,
  branch: string,
) {
  const number = (await reserveRunNumber(tx, orgId, projectId)) as number;
  const context: RunContext = { branch, sha: 'f00dbabe1234', event: 'manual', runNumber: number };
  const spec = validatePipelineYaml(yaml).spec;
  if (!spec) throw new Error('sample pipeline is invalid');
  const plan = compilePlan(spec, context);
  const runId = await insertRun(tx, {
    organizationId: orgId,
    projectId,
    number,
    sourceYaml: yaml,
    plan,
    context,
    triggeredBy: userId,
  });
  return runId;
}

async function seedQueuedRun(
  tx: PoolClient,
  orgId: string,
  projectId: string,
  userId: string,
  yaml: string,
  branch: string,
) {
  await planRun(tx, orgId, projectId, userId, yaml, branch);
}

/** A finished run with logs, so the UI has history before any runner has executed anything. */
async function seedHistoricalRun(
  tx: PoolClient,
  orgId: string,
  projectId: string,
  userId: string,
): Promise<void> {
  const runId = await planRun(tx, orgId, projectId, userId, PAYMENTS_PIPELINE, 'main');
  await tx.query(
    `UPDATE jobs SET status = 'succeeded', attempt = 1, exit_code = 0,
            queued_at = now() - interval '10 minutes', started_at = now() - interval '9 minutes',
            finished_at = now() - interval '8 minutes'
     WHERE run_id = $1`,
    [runId],
  );
  await tx.query(
    `UPDATE job_steps SET status = 'succeeded', exit_code = 0, started_at = now() - interval '9 minutes',
            finished_at = now() - interval '8 minutes'
     WHERE job_id IN (SELECT id FROM jobs WHERE run_id = $1)`,
    [runId],
  );
  await tx.query(
    `INSERT INTO job_log_chunks (job_id, seq, attempt, stream, content)
     SELECT id, 1, 1, 'system', '[railyard] ' || name || E' - attempt 1 on seed-runner\\n' FROM jobs WHERE run_id = $1
     UNION ALL
     SELECT id, 2, 1, 'stdout', E'\\u001b[32mok\\u001b[0m ' || name || E' finished\\n' FROM jobs WHERE run_id = $1`,
    [runId],
  );
  await tx.query(
    `UPDATE pipeline_runs SET status = 'succeeded', started_at = now() - interval '9 minutes',
            finished_at = now() - interval '8 minutes' WHERE id = $1`,
    [runId],
  );
}
