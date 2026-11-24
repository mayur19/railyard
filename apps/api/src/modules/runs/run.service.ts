import {
  compilePlan,
  PlanError,
  validatePipelineYaml,
  type CreateRunInput,
  type ExecutionPlan,
  type PipelineIssue,
  type RunContext,
} from '@railyard/shared';
import { withTransaction, type Pool } from '../../db/pool.js';
import { notFound, unprocessable } from '../../http/errors.js';
import type { AuthPrincipal } from '../auth/auth.service.js';
import { writeAudit } from '../audit/audit.repository.js';
import { reserveRunNumber } from '../projects/project.repository.js';
import { notifyJob } from './notify.js';
import { findRun, insertRun, type RunDetail } from './run.repository.js';

export interface PlanPreview {
  readonly valid: boolean;
  readonly issues: readonly PipelineIssue[];
  readonly plan: ExecutionPlan | null;
}

/** Validates YAML and, when valid, compiles a plan for the given context (no persistence). */
export function previewPlan(yaml: string, context: RunContext): PlanPreview {
  const result = validatePipelineYaml(yaml);
  if (!result.spec) return { valid: false, issues: result.issues, plan: null };
  try {
    return { valid: true, issues: result.issues, plan: compilePlan(result.spec, context) };
  } catch (err) {
    if (err instanceof PlanError) {
      const issue: PipelineIssue = {
        severity: 'error',
        code: 'plan_too_large',
        path: '$',
        message: err.message,
      };
      return { valid: false, issues: [...result.issues, issue], plan: null };
    }
    throw err;
  }
}

/**
 * Creates a run: validate -> plan -> reserve run number -> persist run, jobs and steps -> audit,
 * all inside one transaction so a run is never visible half-created.
 */
export async function createRun(
  pool: Pool,
  principal: AuthPrincipal,
  projectId: string,
  input: CreateRunInput,
  requestId: string,
): Promise<RunDetail> {
  const runId = await withTransaction(pool, async (tx) => {
    const number = await reserveRunNumber(tx, principal.organizationId, projectId);
    if (number === null) throw notFound('Project');
    const context: RunContext = {
      branch: input.branch,
      sha: input.sha,
      event: input.event,
      runNumber: number,
    };
    const preview = previewPlan(input.yaml, context);
    if (!preview.plan) {
      throw unprocessable('PIPELINE_INVALID', 'Pipeline definition is invalid', {
        issues: preview.issues,
      });
    }
    if (preview.plan.jobs.length === 0) {
      throw unprocessable('EMPTY_PLAN', 'No jobs match this branch and event', {
        excluded: preview.plan.excluded,
      });
    }
    const id = await insertRun(tx, {
      organizationId: principal.organizationId,
      projectId,
      number,
      sourceYaml: input.yaml,
      plan: preview.plan,
      context,
      triggeredBy: principal.userId,
    });
    await writeAudit(tx, {
      organizationId: principal.organizationId,
      actorUserId: principal.userId,
      action: 'run.created',
      targetType: 'pipeline_run',
      targetId: id,
      metadata: { projectId, number, jobs: preview.plan.jobs.length },
      requestId,
    });
    await notifyJob(tx, { runId: id, jobId: '', status: 'queued' });
    return id;
  });
  return (await findRun(pool, principal.organizationId, runId)) as RunDetail;
}
