import { createResolver } from './context.js';
import { buildGraph, criticalPath, topologicalLevels } from './dag.js';
import { evaluate, parseExpression, truthy } from './expression.js';
import { interpolate } from './interpolate.js';
import { PIPELINE_LIMITS } from './limits.js';
import { expandMatrix, instanceKey, instanceName, type Combination } from './matrix.js';
import type {
  ExcludedJob,
  ExecutionPlan,
  JobSpec,
  PipelineSpec,
  PlannedJob,
  PlannedStep,
  RunContext,
} from './types.js';

export class PlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanError';
  }
}

interface Instance {
  readonly job: JobSpec;
  readonly combo: Combination | null;
  readonly key: string;
}

/**
 * Compiles a validated pipeline into an execution plan for one run:
 *  1. expand matrices and evaluate `if:` per instance (instances whose condition is false are dropped);
 *  2. cascade exclusion to jobs whose explicit `needs` reference a fully-excluded job;
 *  3. resolve implicit stage dependencies (previous non-empty stage);
 *  4. topologically level the instance graph and compute the critical path;
 *  5. interpolate names, env and step scripts.
 * Pure and deterministic: the same spec and context always yield the same plan.
 */
export function compilePlan(spec: PipelineSpec, run: RunContext): ExecutionPlan {
  const excluded: ExcludedJob[] = [];
  const instancesByJob = new Map<string, Instance[]>();
  for (const job of jobsInDependencyOrder(spec)) {
    const blocker = (job.needs ?? []).find((need) => (instancesByJob.get(need) ?? []).length === 0);
    if (blocker !== undefined) {
      excluded.push({
        jobId: job.id,
        reason: `needs '${blocker}', which is excluded from this run`,
      });
      instancesByJob.set(job.id, []);
      continue;
    }
    const instances = expandInstances(spec, job, run);
    if (instances.length === 0) excluded.push({ jobId: job.id, reason: 'if condition is false' });
    instancesByJob.set(job.id, instances);
  }
  const ordered = spec.jobs.flatMap((job) => instancesByJob.get(job.id) ?? []);
  if (ordered.length > PIPELINE_LIMITS.maxPlannedJobs) {
    throw new PlanError(
      `run would create ${ordered.length} jobs (limit ${PIPELINE_LIMITS.maxPlannedJobs})`,
    );
  }
  const needsByKey = new Map(
    ordered.map((inst) => [inst.key, resolveNeeds(spec, inst.job, instancesByJob)]),
  );
  const graph = buildGraph(ordered.map((inst) => [inst.key, needsByKey.get(inst.key) ?? []]));
  const levels = topologicalLevels(graph);
  const levelOf = new Map(
    levels.flatMap((keys, level) => keys.map((key) => [key, level] as const)),
  );
  const stageIndex = new Map(spec.stages.map((stage, index) => [stage, index]));
  const jobs = ordered.map((inst) =>
    planJob(
      spec,
      run,
      inst,
      needsByKey.get(inst.key) ?? [],
      levelOf.get(inst.key) ?? 0,
      stageIndex,
    ),
  );
  return {
    pipelineName: spec.name,
    stages: spec.stages,
    jobs,
    levels,
    excluded,
    criticalPath: ordered.length > 0 ? criticalPath(graph) : [],
  };
}

/** Job ids ordered so that explicit needs come before dependents (validated acyclic). */
function jobsInDependencyOrder(spec: PipelineSpec): JobSpec[] {
  const byId = new Map(spec.jobs.map((job) => [job.id, job]));
  const graph = buildGraph(
    spec.jobs.map((job) => [job.id, (job.needs ?? []).filter((n) => byId.has(n))]),
  );
  return topologicalLevels(graph)
    .flat()
    .map((id) => byId.get(id) as JobSpec);
}

function expandInstances(spec: PipelineSpec, job: JobSpec, run: RunContext): Instance[] {
  const combos: (Combination | null)[] = job.matrix ? expandMatrix(job.matrix) : [null];
  const condition = job.condition === null ? null : parseExpression(job.condition);
  return combos
    .filter((combo) => {
      if (!condition) return true;
      const env = { ...spec.env, ...job.env };
      return truthy(evaluate(condition, createResolver(run, env, combo)));
    })
    .map((combo) => ({ job, combo, key: instanceKey(job.id, combo) }));
}

function resolveNeeds(
  spec: PipelineSpec,
  job: JobSpec,
  instancesByJob: ReadonlyMap<string, Instance[]>,
): string[] {
  if (job.needs !== null) {
    return job.needs.flatMap((need) => (instancesByJob.get(need) ?? []).map((inst) => inst.key));
  }
  const ownIndex = spec.stages.indexOf(job.stage);
  for (let index = ownIndex - 1; index >= 0; index -= 1) {
    const stage = spec.stages[index];
    const keys = spec.jobs
      .filter((candidate) => candidate.stage === stage)
      .flatMap((candidate) => (instancesByJob.get(candidate.id) ?? []).map((inst) => inst.key));
    if (keys.length > 0) return keys;
  }
  return [];
}

function planJob(
  spec: PipelineSpec,
  run: RunContext,
  inst: Instance,
  needs: readonly string[],
  level: number,
  stageIndex: ReadonlyMap<string, number>,
): PlannedJob {
  const { job, combo } = inst;
  const baseResolver = createResolver(run, spec.env, combo);
  const jobEnv = mapValues(job.env, (value) => interpolate(value, baseResolver));
  const env = { ...builtinEnv(run, job, combo), ...spec.env, ...jobEnv };
  return {
    key: inst.key,
    jobId: job.id,
    name: instanceName(interpolate(job.name, createResolver(run, env, combo)), combo),
    stage: job.stage,
    stageIndex: stageIndex.get(job.stage) ?? 0,
    matrix: combo,
    needs,
    level,
    when: job.when,
    allowFailure: job.allowFailure,
    timeoutSeconds: job.timeoutMinutes * 60,
    retries: job.retries,
    runsOn: job.runsOn,
    env,
    steps: job.steps.map((step, index): PlannedStep => {
      const stepEnv = mapValues(step.env, (value) =>
        interpolate(value, createResolver(run, env, combo)),
      );
      const resolver = createResolver(run, { ...env, ...stepEnv }, combo);
      return {
        index,
        name: interpolate(step.name, resolver),
        run: interpolate(step.run, resolver),
        env: stepEnv,
        timeoutSeconds: (step.timeoutMinutes ?? job.timeoutMinutes) * 60,
        continueOnError: step.continueOnError,
        workingDirectory: step.workingDirectory,
      };
    }),
  };
}

function builtinEnv(
  run: RunContext,
  job: JobSpec,
  combo: Combination | null,
): Record<string, string> {
  const matrixEnv = Object.fromEntries(
    Object.entries(combo ?? {}).map(([axis, value]) => [
      `MATRIX_${axis.toUpperCase().replace(/-/g, '_')}`,
      String(value),
    ]),
  );
  return {
    CI: 'true',
    RAILYARD: 'true',
    RAILYARD_BRANCH: run.branch,
    RAILYARD_SHA: run.sha,
    RAILYARD_EVENT: run.event,
    RAILYARD_RUN_NUMBER: String(run.runNumber),
    RAILYARD_JOB: job.id,
    ...matrixEnv,
  };
}

function mapValues(
  record: Readonly<Record<string, string>>,
  fn: (value: string) => string,
): Record<string, string> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, fn(value)]));
}
