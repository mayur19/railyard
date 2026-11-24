import type { JobWhen } from '../pipeline/types.js';

export const JOB_STATUSES = [
  'blocked',
  'queued',
  'running',
  'succeeded',
  'failed',
  'timed_out',
  'cancelled',
  'skipped',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const TERMINAL_JOB_STATUSES: ReadonlySet<JobStatus> = new Set([
  'succeeded',
  'failed',
  'timed_out',
  'cancelled',
  'skipped',
]);

const TRANSITIONS: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  blocked: ['queued', 'skipped', 'cancelled'],
  queued: ['running', 'cancelled'],
  // running -> queued happens when a lease expires or a retry is scheduled.
  running: ['succeeded', 'failed', 'timed_out', 'cancelled', 'queued'],
  succeeded: [],
  failed: [],
  timed_out: [],
  cancelled: [],
  skipped: [],
};

export function isTerminal(status: JobStatus): boolean {
  return TERMINAL_JOB_STATUSES.has(status);
}

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: JobStatus,
    readonly to: JobStatus,
  ) {
    super(`invalid job transition ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export function assertTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

/** Minimal view of a job needed for scheduling decisions. */
export interface SchedulableJob {
  readonly key: string;
  readonly status: JobStatus;
  readonly needs: readonly string[];
  readonly when: JobWhen;
  readonly allowFailure: boolean;
}

export interface StatusChange {
  readonly key: string;
  readonly from: JobStatus;
  readonly to: JobStatus;
}

function isFailure(job: SchedulableJob): boolean {
  return (job.status === 'failed' || job.status === 'timed_out') && !job.allowFailure;
}

function isSatisfied(job: SchedulableJob): boolean {
  return (
    job.status === 'succeeded' ||
    ((job.status === 'failed' || job.status === 'timed_out') && job.allowFailure)
  );
}

/**
 * Decides what happens to blocked jobs once their dependencies settle. Iterates to a fixed
 * point so skips propagate down long chains in a single call. Pure: returns the changes
 * without mutating the input. O(iterations * (V + E)), iterations <= depth of the DAG.
 *
 *  - on_success: queued when every dependency is satisfied, otherwise skipped
 *  - on_failure: queued when any transitive ancestor failed, otherwise skipped
 *  - always:     queued once every dependency is terminal
 * A cancelled dependency cancels on_success/on_failure dependents.
 */
export function resolveBlockedJobs(jobs: readonly SchedulableJob[]): StatusChange[] {
  const current = new Map(jobs.map((job) => [job.key, job]));
  const changes: StatusChange[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const job of current.values()) {
      if (job.status !== 'blocked') continue;
      const deps = job.needs
        .map((key) => current.get(key))
        .filter((dep): dep is SchedulableJob => !!dep);
      if (deps.some((dep) => !isTerminal(dep.status))) continue;
      const next = decide(job, deps, current);
      changes.push({ key: job.key, from: job.status, to: next });
      current.set(job.key, { ...job, status: next });
      changed = true;
    }
  }
  return changes;
}

function decide(
  job: SchedulableJob,
  deps: readonly SchedulableJob[],
  all: ReadonlyMap<string, SchedulableJob>,
): JobStatus {
  if (job.when === 'always') return 'queued';
  if (deps.some((dep) => dep.status === 'cancelled')) return 'cancelled';
  if (job.when === 'on_failure') return ancestorFailed(job, all) ? 'queued' : 'skipped';
  return deps.every(isSatisfied) ? 'queued' : 'skipped';
}

function ancestorFailed(job: SchedulableJob, all: ReadonlyMap<string, SchedulableJob>): boolean {
  const seen = new Set<string>();
  const stack = [...job.needs];
  while (stack.length > 0) {
    const key = stack.pop() as string;
    if (seen.has(key)) continue;
    seen.add(key);
    const dep = all.get(key);
    if (!dep) continue;
    if (isFailure(dep)) return true;
    stack.push(...dep.needs);
  }
  return false;
}

/** Initial status for a freshly planned job. */
export function initialStatus(needs: readonly string[]): JobStatus {
  return needs.length === 0 ? 'queued' : 'blocked';
}

/** Aggregate run status from its job statuses. */
export function deriveRunStatus(
  jobs: readonly Pick<SchedulableJob, 'status' | 'allowFailure'>[],
): RunStatus {
  if (jobs.length === 0) return 'succeeded';
  if (jobs.some((job) => !isTerminal(job.status))) {
    return jobs.some((job) => job.status === 'running' || isTerminal(job.status))
      ? 'running'
      : 'queued';
  }
  if (jobs.some((job) => job.status === 'cancelled')) return 'cancelled';
  const failed = jobs.some(
    (job) => (job.status === 'failed' || job.status === 'timed_out') && !job.allowFailure,
  );
  return failed ? 'failed' : 'succeeded';
}

export interface AttemptOutcome {
  readonly status: JobStatus;
  readonly retry: boolean;
}

/** After an attempt fails or times out, decide whether to retry (requeue) or settle. */
export function outcomeAfterAttempt(
  result: 'succeeded' | 'failed' | 'timed_out' | 'cancelled',
  attempt: number,
  retries: number,
): AttemptOutcome {
  if ((result === 'failed' || result === 'timed_out') && attempt <= retries) {
    return { status: 'queued', retry: true };
  }
  return { status: result, retry: false };
}
