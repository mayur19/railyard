import {
  initialStatus,
  type ExecutionPlan,
  type JobStatus,
  type RunContext,
  type RunStatus,
} from '@railyard/shared';
import type { Queryable } from '../../db/pool.js';

export interface RunSummary {
  readonly id: string;
  readonly projectId: string;
  readonly number: number;
  readonly status: RunStatus;
  readonly pipelineName: string;
  readonly branch: string;
  readonly commitSha: string;
  readonly triggerEvent: string;
  readonly createdAt: Date;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly jobCounts: Record<string, number>;
}

export interface StepView {
  readonly id: string;
  readonly position: number;
  readonly name: string;
  readonly status: string;
  readonly exitCode: number | null;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
}

export interface JobView {
  readonly id: string;
  readonly key: string;
  readonly jobRef: string;
  readonly name: string;
  readonly stage: string;
  readonly stageIndex: number;
  readonly level: number;
  readonly matrix: Record<string, unknown> | null;
  readonly needs: string[];
  readonly when: string;
  readonly allowFailure: boolean;
  readonly status: JobStatus;
  readonly attempt: number;
  readonly retries: number;
  readonly exitCode: number | null;
  readonly failureReason: string | null;
  readonly queuedAt: Date | null;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly steps: StepView[];
}

export interface RunDetail extends RunSummary {
  readonly stages: string[];
  readonly criticalPath: string[];
  readonly excluded: { jobId: string; reason: string }[];
  readonly jobs: JobView[];
}

export interface NewRun {
  readonly organizationId: string;
  readonly projectId: string;
  readonly number: number;
  readonly sourceYaml: string;
  readonly plan: ExecutionPlan;
  readonly context: RunContext;
  readonly triggeredBy: string | null;
}

const RUN_COLUMNS = `
  r.id, r.project_id AS "projectId", r.number, r.status, r.pipeline_name AS "pipelineName", r.branch,
  r.commit_sha AS "commitSha", r.trigger_event AS "triggerEvent", r.created_at AS "createdAt",
  r.started_at AS "startedAt", r.finished_at AS "finishedAt",
  (SELECT coalesce(json_object_agg(s.status, s.n), '{}'::json)
     FROM (SELECT status, count(*) AS n FROM jobs WHERE run_id = r.id GROUP BY status) s) AS "jobCounts"`;

/**
 * Inserts the run, its jobs and steps with three statements regardless of plan size, using
 * jsonb_to_recordset for set-based inserts (a 1000-job plan stays a single round trip each).
 */
export async function insertRun(db: Queryable, run: NewRun): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO pipeline_runs (organization_id, project_id, number, status, pipeline_name, source_yaml, plan,
                                branch, commit_sha, trigger_event, triggered_by)
     VALUES ($1, $2, $3, 'queued', $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [
      run.organizationId,
      run.projectId,
      run.number,
      run.plan.pipelineName,
      run.sourceYaml,
      JSON.stringify({
        stages: run.plan.stages,
        levels: run.plan.levels,
        criticalPath: run.plan.criticalPath,
        excluded: run.plan.excluded,
      }),
      run.context.branch,
      run.context.sha,
      run.context.event,
      run.triggeredBy,
    ],
  );
  const runId = (rows[0] as { id: string }).id;
  const jobRecords = run.plan.jobs.map((job) => ({
    key: job.key,
    job_ref: job.jobId,
    name: job.name,
    stage: job.stage,
    stage_index: job.stageIndex,
    level: job.level,
    matrix: job.matrix,
    needs: job.needs,
    run_when: job.when,
    allow_failure: job.allowFailure,
    status: initialStatus(job.needs),
    retries: job.retries,
    timeout_seconds: job.timeoutSeconds,
    runs_on: job.runsOn,
    env: job.env,
  }));
  const inserted = await db.query<{ id: string; key: string }>(
    `INSERT INTO jobs (organization_id, run_id, key, job_ref, name, stage, stage_index, level, matrix, needs, run_when,
                       allow_failure, status, retries, timeout_seconds, runs_on, env, queued_at)
     SELECT $1, $2, x.key, x.job_ref, x.name, x.stage, x.stage_index, x.level, x.matrix,
            ARRAY(SELECT jsonb_array_elements_text(x.needs)), x.run_when, x.allow_failure, x.status, x.retries,
            x.timeout_seconds, ARRAY(SELECT jsonb_array_elements_text(x.runs_on)), x.env,
            CASE WHEN x.status = 'queued' THEN clock_timestamp() END
     FROM jsonb_to_recordset($3::jsonb) AS x(key text, job_ref text, name text, stage text, stage_index int, level int,
          matrix jsonb, needs jsonb, run_when text, allow_failure boolean, status text, retries int,
          timeout_seconds int, runs_on jsonb, env jsonb)
     RETURNING id, key`,
    [run.organizationId, runId, JSON.stringify(jobRecords)],
  );
  const idByKey = new Map(inserted.rows.map((row) => [row.key, row.id]));
  const stepRecords = run.plan.jobs.flatMap((job) =>
    job.steps.map((step) => ({
      job_id: idByKey.get(job.key),
      position: step.index,
      name: step.name,
      script: step.run,
      env: step.env,
      timeout_seconds: step.timeoutSeconds,
      continue_on_error: step.continueOnError,
      working_directory: step.workingDirectory,
    })),
  );
  await db.query(
    `INSERT INTO job_steps (job_id, position, name, script, env, timeout_seconds, continue_on_error, working_directory)
     SELECT x.job_id, x.position, x.name, x.script, x.env, x.timeout_seconds, x.continue_on_error, x.working_directory
     FROM jsonb_to_recordset($1::jsonb) AS x(job_id uuid, position int, name text, script text, env jsonb,
          timeout_seconds int, continue_on_error boolean, working_directory text)`,
    [JSON.stringify(stepRecords)],
  );
  return runId;
}

export async function listRuns(
  db: Queryable,
  organizationId: string,
  projectId: string,
  limit: number,
  beforeNumber: number | null,
): Promise<RunSummary[]> {
  const { rows } = await db.query<RunSummary>(
    `SELECT ${RUN_COLUMNS} FROM pipeline_runs r
     WHERE r.organization_id = $1 AND r.project_id = $2 AND ($3::int IS NULL OR r.number < $3)
     ORDER BY r.number DESC LIMIT $4`,
    [organizationId, projectId, beforeNumber, limit],
  );
  return rows;
}

export async function findRun(
  db: Queryable,
  organizationId: string,
  runId: string,
): Promise<RunDetail | null> {
  const { rows } = await db.query<
    RunSummary & {
      plan: { stages: string[]; criticalPath: string[]; excluded: RunDetail['excluded'] };
    }
  >(
    `SELECT ${RUN_COLUMNS}, r.plan FROM pipeline_runs r WHERE r.organization_id = $1 AND r.id = $2`,
    [organizationId, runId],
  );
  const row = rows[0];
  if (!row) return null;
  const { plan, ...summary } = row;
  const jobs = await db.query<JobView>(
    `SELECT j.id, j.key, j.job_ref AS "jobRef", j.name, j.stage, j.stage_index AS "stageIndex", j.level, j.matrix,
            j.needs, j.run_when AS "when", j.allow_failure AS "allowFailure", j.status, j.attempt, j.retries,
            j.exit_code AS "exitCode", j.failure_reason AS "failureReason", j.queued_at AS "queuedAt",
            j.started_at AS "startedAt", j.finished_at AS "finishedAt",
            coalesce((SELECT json_agg(json_build_object('id', s.id, 'position', s.position, 'name', s.name,
                        'status', s.status, 'exitCode', s.exit_code, 'startedAt', s.started_at,
                        'finishedAt', s.finished_at) ORDER BY s.position)
                      FROM job_steps s WHERE s.job_id = j.id), '[]'::json) AS steps
     FROM jobs j WHERE j.run_id = $1 AND j.organization_id = $2
     ORDER BY j.level, j.stage_index, j.created_at, j.key`,
    [runId, organizationId],
  );
  return {
    ...summary,
    stages: plan.stages,
    criticalPath: plan.criticalPath,
    excluded: plan.excluded,
    jobs: jobs.rows,
  };
}

export async function findJobInOrganization(
  db: Queryable,
  organizationId: string,
  runId: string,
  jobId: string,
): Promise<{ id: string; status: JobStatus } | null> {
  const { rows } = await db.query<{ id: string; status: JobStatus }>(
    'SELECT id, status FROM jobs WHERE id = $1 AND run_id = $2 AND organization_id = $3',
    [jobId, runId, organizationId],
  );
  return rows[0] ?? null;
}
