import { validateCron } from '../cron/cron.js';
import { checkReference, type ReferenceScope } from './context.js';
import { buildGraph, findCycle } from './dag.js';
import { collectReferences, ExpressionError, parseExpression, type Expr } from './expression.js';
import { parseTemplate } from './interpolate.js';
import { checkKeys, IssueCollector, isRecord, type PathPart } from './issues.js';
import { IDENTIFIER_PATTERN, PIPELINE_LIMITS } from './limits.js';
import { countCombinations } from './matrix.js';
import type {
  JobSpec,
  PipelineIssue,
  PipelineSpec,
  ScheduleTrigger,
  TriggerSpec,
} from './types.js';
import { describe, readBoolean, readEnv, readString, readStringList } from './validate-fields.js';
import { readJob } from './validate-job.js';
import { loadYaml } from './yaml.js';

const TOP_KEYS = ['version', 'name', 'on', 'env', 'stages', 'jobs'];

export interface ValidationResult {
  readonly ok: boolean;
  readonly spec: PipelineSpec | null;
  readonly issues: readonly PipelineIssue[];
}

/** Parses and validates pipeline YAML. `spec` is non-null only when there are no errors. */
export function validatePipelineYaml(source: string): ValidationResult {
  const loaded = loadYaml(source);
  if (loaded.issues.length > 0) return { ok: false, spec: null, issues: loaded.issues };
  const issues = new IssueCollector();
  const spec = readPipeline(issues, loaded.value);
  if (spec) checkSemantics(issues, spec);
  const list = issues.list(loaded.locate);
  const ok = !issues.hasErrors && spec !== null;
  return { ok, spec: ok ? spec : null, issues: list };
}

function readPipeline(issues: IssueCollector, value: unknown): PipelineSpec | null {
  if (!isRecord(value)) {
    issues.error('type', [], `pipeline must be a map, got ${describe(value)}`);
    return null;
  }
  checkKeys(issues, value, TOP_KEYS, []);
  if (value.version !== undefined && value.version !== 1) {
    issues.error('unsupported_version', ['version'], 'only version 1 is supported');
  }
  const name = readString(issues, value.name, ['name'], { required: true, max: 100 });
  const stages = readStages(issues, value.stages);
  const jobs = readJobs(issues, value.jobs, stages[0] as string);
  return {
    version: 1,
    name: name ?? 'unnamed',
    triggers: readTriggers(issues, value.on),
    env: readEnv(issues, value.env, ['env']),
    stages,
    jobs,
  };
}

function readStages(issues: IssueCollector, value: unknown): string[] {
  const stages = readStringList(issues, value, ['stages'], {
    pattern: IDENTIFIER_PATTERN,
    patternHint: 'stage names use letters, digits, - and _',
  });
  if (stages === null) return [PIPELINE_LIMITS.defaultStage];
  if (stages.length === 0) {
    issues.error('empty', ['stages'], 'must list at least one stage');
    return [PIPELINE_LIMITS.defaultStage];
  }
  if (stages.length > PIPELINE_LIMITS.maxStages) {
    issues.error('too_many', ['stages'], `at most ${PIPELINE_LIMITS.maxStages} stages are allowed`);
  }
  return stages;
}

function readJobs(issues: IssueCollector, value: unknown, defaultStage: string): JobSpec[] {
  if (value === undefined || value === null) {
    issues.error('required', ['jobs'], 'is required');
    return [];
  }
  if (!isRecord(value)) {
    issues.error('type', ['jobs'], `must be a map of job id: job, got ${describe(value)}`);
    return [];
  }
  const entries = Object.entries(value);
  if (entries.length === 0) issues.error('empty', ['jobs'], 'must define at least one job');
  if (entries.length > PIPELINE_LIMITS.maxJobs) {
    issues.error('too_many', ['jobs'], `at most ${PIPELINE_LIMITS.maxJobs} jobs are allowed`);
  }
  return entries.flatMap(([id, raw]) => {
    const job = readJob(issues, id, raw, defaultStage);
    return job ? [job] : [];
  });
}

function readTriggers(issues: IssueCollector, value: unknown): TriggerSpec {
  const fallback: TriggerSpec = { push: null, manual: true, schedule: [] };
  if (value === undefined || value === null) return fallback;
  if (!isRecord(value)) {
    issues.error('type', ['on'], 'must be a map of trigger: options');
    return fallback;
  }
  checkKeys(issues, value, ['push', 'manual', 'schedule'], ['on']);
  return {
    push: readPush(issues, value.push),
    manual: readBoolean(issues, value.manual, ['on', 'manual']) ?? true,
    schedule: readSchedules(issues, value.schedule),
  };
}

function readPush(issues: IssueCollector, value: unknown): TriggerSpec['push'] {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) {
    issues.error('type', ['on', 'push'], 'must be a map with branches');
    return null;
  }
  checkKeys(issues, value, ['branches'], ['on', 'push']);
  return { branches: readStringList(issues, value.branches, ['on', 'push', 'branches']) ?? ['*'] };
}

function readSchedules(issues: IssueCollector, value: unknown): ScheduleTrigger[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    issues.error('type', ['on', 'schedule'], 'must be a list of { cron: "..." } entries');
    return [];
  }
  return value.flatMap((entry, index) => {
    const path: PathPart[] = ['on', 'schedule', index];
    if (!isRecord(entry)) {
      issues.error('type', path, 'must be a map with a cron expression');
      return [];
    }
    checkKeys(issues, entry, ['cron'], path);
    const cron = readString(issues, entry.cron, [...path, 'cron'], { required: true, max: 120 });
    if (cron === null) return [];
    const problem = validateCron(cron);
    if (problem) {
      issues.error('invalid_cron', [...path, 'cron'], problem);
      return [];
    }
    return [{ cron }];
  });
}

/** Cross-field checks that need the whole pipeline: stages, needs, cycles, expressions, matrix size. */
function checkSemantics(issues: IssueCollector, spec: PipelineSpec): void {
  const stageIndex = new Map(spec.stages.map((stage, index) => [stage, index]));
  const byId = new Map(spec.jobs.map((job) => [job.id, job]));
  for (const job of spec.jobs) {
    const path: PathPart[] = ['jobs', job.id];
    if (!stageIndex.has(job.stage)) {
      issues.error(
        'unknown_stage',
        [...path, 'stage'],
        `stage '${job.stage}' is not listed in stages`,
      );
    }
    checkNeeds(issues, job, byId, stageIndex);
    checkMatrixSize(issues, job);
    checkExpressions(issues, spec, job);
    warnUnimplemented(issues, job);
  }
  const graph = buildGraph(
    spec.jobs.map((job) => [job.id, (job.needs ?? []).filter((n) => byId.has(n) && n !== job.id)]),
  );
  const cycle = findCycle(graph);
  if (cycle)
    issues.error(
      'cycle',
      ['jobs', cycle[0] as string, 'needs'],
      `dependency cycle: ${cycle.join(' -> ')}`,
    );
}

function checkNeeds(
  issues: IssueCollector,
  job: JobSpec,
  byId: ReadonlyMap<string, JobSpec>,
  stageIndex: ReadonlyMap<string, number>,
): void {
  (job.needs ?? []).forEach((need, index) => {
    const path: PathPart[] = ['jobs', job.id, 'needs', index];
    const target = byId.get(need);
    if (need === job.id) issues.error('self_dependency', path, 'a job cannot need itself');
    else if (!target) issues.error('unknown_job', path, `needs unknown job '${need}'`);
    else if ((stageIndex.get(target.stage) ?? 0) > (stageIndex.get(job.stage) ?? 0)) {
      issues.error(
        'later_stage',
        path,
        `'${need}' runs in a later stage (${target.stage}) than '${job.id}' (${job.stage})`,
      );
    }
  });
}

function checkMatrixSize(issues: IssueCollector, job: JobSpec): void {
  if (!job.matrix) return;
  const count = countCombinations(job.matrix);
  if (count === 0)
    issues.error('empty_matrix', ['jobs', job.id, 'matrix'], 'matrix excludes every combination');
  if (count > PIPELINE_LIMITS.maxMatrixCombinations) {
    issues.error(
      'matrix_too_large',
      ['jobs', job.id, 'matrix'],
      `matrix expands to ${count} combinations (limit ${PIPELINE_LIMITS.maxMatrixCombinations})`,
    );
  }
}

function scopeFor(
  spec: PipelineSpec,
  job: JobSpec,
  extraEnv: Readonly<Record<string, string>> = {},
): ReferenceScope {
  const axes = job.matrix
    ? new Set([
        ...Object.keys(job.matrix.axes),
        ...job.matrix.include.flatMap((combo) => Object.keys(combo)),
      ])
    : null;
  return {
    matrixAxes: axes,
    envNames: new Set([
      ...Object.keys(spec.env),
      ...Object.keys(job.env),
      ...Object.keys(extraEnv),
    ]),
  };
}

function checkExpressions(issues: IssueCollector, spec: PipelineSpec, job: JobSpec): void {
  const scope = scopeFor(spec, job);
  if (job.condition !== null) {
    checkExpr(issues, ['jobs', job.id, 'if'], scope, () => [
      parseExpression(job.condition as string),
    ]);
  }
  checkTemplate(issues, ['jobs', job.id, 'name'], scope, job.name);
  job.steps.forEach((step, index) => {
    const stepScope = scopeFor(spec, job, step.env);
    checkTemplate(issues, ['jobs', job.id, 'steps', index, 'run'], stepScope, step.run);
    for (const [key, value] of Object.entries(step.env)) {
      checkTemplate(issues, ['jobs', job.id, 'steps', index, 'env', key], scope, value);
    }
  });
  for (const [key, value] of Object.entries(job.env)) {
    checkTemplate(
      issues,
      ['jobs', job.id, 'env', key],
      { ...scope, envNames: new Set(Object.keys(spec.env)) },
      value,
    );
  }
}

function checkTemplate(
  issues: IssueCollector,
  path: PathPart[],
  scope: ReferenceScope,
  template: string,
): void {
  if (!template.includes('${{')) return;
  checkExpr(issues, path, scope, () => parseTemplate(template).map((p) => p.expr));
}

function checkExpr(
  issues: IssueCollector,
  path: PathPart[],
  scope: ReferenceScope,
  parse: () => Expr[],
): void {
  let exprs: Expr[];
  try {
    exprs = parse();
  } catch (err) {
    const message = err instanceof ExpressionError ? err.message : String(err);
    issues.error('expression_syntax', path, `invalid expression: ${message}`);
    return;
  }
  for (const ref of exprs.flatMap(collectReferences)) {
    const problem = checkReference(ref, scope);
    if (problem) issues.error('unknown_reference', path, problem);
  }
}

function warnUnimplemented(issues: IssueCollector, job: JobSpec): void {
  const pending: [keyof JobSpec, string, string][] = [
    ['cache', 'cache', 'RY-083'],
    ['artifacts', 'artifacts', 'RY-080'],
    ['environment', 'environment', 'RY-090'],
    ['concurrency', 'concurrency', 'RY-095'],
  ];
  for (const [field, key, ticket] of pending) {
    if (job[field] !== null) {
      issues.warn(
        'not_yet_executed',
        ['jobs', job.id, key],
        `'${key}' is validated but not executed yet (${ticket})`,
      );
    }
  }
}
