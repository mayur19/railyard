import { checkKeys, isRecord, isScalar, type IssueCollector, type PathPart } from './issues.js';
import { IDENTIFIER_PATTERN, PIPELINE_LIMITS } from './limits.js';
import type { JobSpec, JobWhen, MatrixSpec, Scalar, StepSpec } from './types.js';
import {
  describe,
  isSafeRelativePath,
  readArtifacts,
  readBoolean,
  readCache,
  readEnv,
  readInteger,
  readScalarMap,
  readString,
  readStringList,
} from './validate-fields.js';

const JOB_KEYS = [
  'name',
  'stage',
  'needs',
  'if',
  'when',
  'runs-on',
  'env',
  'matrix',
  'timeout-minutes',
  'retries',
  'allow-failure',
  'steps',
  'cache',
  'artifacts',
  'environment',
  'concurrency',
] as const;
const STEP_KEYS = [
  'name',
  'run',
  'env',
  'timeout-minutes',
  'continue-on-error',
  'working-directory',
];
const WHEN_VALUES: readonly JobWhen[] = ['on_success', 'on_failure', 'always'];
const MATRIX_RESERVED = ['include', 'exclude'];

/** Structural validation of a single job. Cross-job checks happen in validate.ts. */
export function readJob(
  issues: IssueCollector,
  id: string,
  value: unknown,
  defaultStage: string,
): JobSpec | null {
  const path: PathPart[] = ['jobs', id];
  if (!IDENTIFIER_PATTERN.test(id)) {
    issues.error(
      'pattern',
      path,
      `job id '${id}' must start with a letter and contain only letters, digits, - or _`,
    );
    return null;
  }
  if (!isRecord(value)) {
    issues.error('type', path, `job must be a map, got ${describe(value)}`);
    return null;
  }
  checkKeys(issues, value, JOB_KEYS, path);
  const steps = readSteps(issues, value.steps, [...path, 'steps']);
  const when = readWhen(issues, value.when, [...path, 'when']);
  return {
    id,
    name: readString(issues, value.name, [...path, 'name'], { max: 100 }) ?? id,
    stage: readString(issues, value.stage, [...path, 'stage'], { max: 63 }) ?? defaultStage,
    needs: readStringList(issues, value.needs, [...path, 'needs'], { allowSingle: true }),
    condition: readString(issues, value.if, [...path, 'if'], { max: 1024 }),
    when,
    runsOn:
      readStringList(issues, value['runs-on'], [...path, 'runs-on'], { allowSingle: true }) ?? [],
    env: readEnv(issues, value.env, [...path, 'env']),
    matrix: readMatrix(issues, value.matrix, [...path, 'matrix']),
    timeoutMinutes:
      readInteger(
        issues,
        value['timeout-minutes'],
        [...path, 'timeout-minutes'],
        1,
        PIPELINE_LIMITS.maxTimeoutMinutes,
      ) ?? PIPELINE_LIMITS.defaultTimeoutMinutes,
    retries:
      readInteger(issues, value.retries, [...path, 'retries'], 0, PIPELINE_LIMITS.maxRetries) ?? 0,
    allowFailure: readBoolean(issues, value['allow-failure'], [...path, 'allow-failure']) ?? false,
    steps,
    cache: readCache(issues, value.cache, [...path, 'cache']),
    artifacts: readArtifacts(issues, value.artifacts, [...path, 'artifacts']),
    environment: readString(issues, value.environment, [...path, 'environment'], {
      pattern: IDENTIFIER_PATTERN,
      patternHint: 'environment names use letters, digits, - and _',
    }),
    concurrency: readString(issues, value.concurrency, [...path, 'concurrency'], { max: 128 }),
  };
}

function readWhen(issues: IssueCollector, value: unknown, path: PathPart[]): JobWhen {
  if (value === undefined || value === null) return 'on_success';
  if (typeof value === 'string' && (WHEN_VALUES as readonly string[]).includes(value))
    return value as JobWhen;
  issues.error('enum', path, `must be one of ${WHEN_VALUES.join(', ')}`);
  return 'on_success';
}

function readSteps(issues: IssueCollector, value: unknown, path: PathPart[]): StepSpec[] {
  if (value === undefined || value === null) {
    issues.error('required', path, 'a job needs at least one step');
    return [];
  }
  if (!Array.isArray(value)) {
    issues.error('type', path, `must be a list of steps, got ${describe(value)}`);
    return [];
  }
  if (value.length === 0) issues.error('empty', path, 'a job needs at least one step');
  if (value.length > PIPELINE_LIMITS.maxStepsPerJob) {
    issues.error(
      'too_many',
      path,
      `a job may have at most ${PIPELINE_LIMITS.maxStepsPerJob} steps`,
    );
  }
  return value.flatMap((raw, index) => {
    const step = readStep(issues, raw, [...path, index], index);
    return step ? [step] : [];
  });
}

function readStep(
  issues: IssueCollector,
  raw: unknown,
  path: PathPart[],
  index: number,
): StepSpec | null {
  // Shorthand: `- echo hello` is equivalent to `- run: echo hello`.
  const value = typeof raw === 'string' ? { run: raw } : raw;
  if (!isRecord(value)) {
    issues.error('type', path, `step must be a map or a command string, got ${describe(raw)}`);
    return null;
  }
  checkKeys(issues, value, STEP_KEYS, path);
  const run = readString(issues, value.run, [...path, 'run'], { required: true, max: 64 * 1024 });
  const workingDirectory = readString(
    issues,
    value['working-directory'],
    [...path, 'working-directory'],
    {
      max: 512,
    },
  );
  if (workingDirectory !== null && !isSafeRelativePath(workingDirectory)) {
    issues.error(
      'unsafe_path',
      [...path, 'working-directory'],
      'must be a relative path inside the workspace',
    );
  }
  const timeout = readInteger(
    issues,
    value['timeout-minutes'],
    [...path, 'timeout-minutes'],
    1,
    PIPELINE_LIMITS.maxTimeoutMinutes,
  );
  if (run === null) return null;
  return {
    name:
      readString(issues, value.name, [...path, 'name'], { max: 100 }) ??
      defaultStepName(run, index),
    run,
    env: readEnv(issues, value.env, [...path, 'env']),
    timeoutMinutes: timeout,
    continueOnError:
      readBoolean(issues, value['continue-on-error'], [...path, 'continue-on-error']) ?? false,
    workingDirectory:
      workingDirectory !== null && isSafeRelativePath(workingDirectory) ? workingDirectory : null,
  };
}

function defaultStepName(run: string, index: number): string {
  const firstLine = run.split('\n')[0]?.trim() ?? '';
  return firstLine.length > 0 ? firstLine.slice(0, 60) : `step ${index + 1}`;
}

function readMatrix(issues: IssueCollector, value: unknown, path: PathPart[]): MatrixSpec | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) {
    issues.error('type', path, `matrix must be a map of axis: [values], got ${describe(value)}`);
    return null;
  }
  const axes: Record<string, Scalar[]> = {};
  for (const [axis, raw] of Object.entries(value)) {
    if (MATRIX_RESERVED.includes(axis)) continue;
    const values = readAxis(issues, axis, raw, [...path, axis]);
    if (values) axes[axis] = values;
  }
  const axisCount = Object.keys(axes).length;
  if (axisCount > PIPELINE_LIMITS.maxMatrixAxes) {
    issues.error(
      'too_many',
      path,
      `a matrix may declare at most ${PIPELINE_LIMITS.maxMatrixAxes} axes`,
    );
  }
  const include = readCombos(issues, value.include, [...path, 'include']);
  const exclude = readCombos(issues, value.exclude, [...path, 'exclude']);
  if (axisCount === 0 && include.length === 0) {
    issues.error('empty', path, 'matrix must declare at least one axis or include entry');
    return null;
  }
  exclude.forEach((combo, index) => {
    for (const key of Object.keys(combo)) {
      if (!(key in axes)) {
        issues.error(
          'unknown_axis',
          [...path, 'exclude', index, key],
          `exclude references unknown axis '${key}'`,
        );
      }
    }
  });
  return { axes, include, exclude };
}

function readAxis(
  issues: IssueCollector,
  axis: string,
  raw: unknown,
  path: PathPart[],
): Scalar[] | null {
  if (!IDENTIFIER_PATTERN.test(axis)) {
    issues.error('pattern', path, `'${axis}' is not a valid axis name`);
    return null;
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    issues.error('type', path, 'axis must be a non-empty list of values');
    return null;
  }
  if (raw.length > PIPELINE_LIMITS.maxMatrixValuesPerAxis) {
    issues.error(
      'too_many',
      path,
      `axis may list at most ${PIPELINE_LIMITS.maxMatrixValuesPerAxis} values`,
    );
    return null;
  }
  const seen = new Set<string>();
  const values: Scalar[] = [];
  raw.forEach((item, index) => {
    if (!isScalar(item)) {
      issues.error('type', [...path, index], 'axis values must be strings, numbers or booleans');
    } else if (seen.has(String(item))) {
      issues.error('duplicate', [...path, index], `duplicate axis value '${String(item)}'`);
    } else {
      seen.add(String(item));
      values.push(item);
    }
  });
  return values;
}

function readCombos(
  issues: IssueCollector,
  value: unknown,
  path: PathPart[],
): Record<string, Scalar>[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    issues.error('type', path, 'must be a list of maps');
    return [];
  }
  return value.flatMap((raw, index) => {
    const combo = readScalarMap(issues, raw, [...path, index]);
    return combo ? [combo] : [];
  });
}
