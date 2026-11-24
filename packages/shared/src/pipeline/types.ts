/** A scalar value allowed in matrices, env maps and expressions. */
export type Scalar = string | number | boolean;

export type JobWhen = 'on_success' | 'on_failure' | 'always';

export type TriggerEvent = 'push' | 'manual' | 'schedule' | 'api';

export interface StepSpec {
  readonly name: string;
  readonly run: string;
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMinutes: number | null;
  readonly continueOnError: boolean;
  readonly workingDirectory: string | null;
}

export interface MatrixSpec {
  readonly axes: Readonly<Record<string, readonly Scalar[]>>;
  readonly include: readonly Readonly<Record<string, Scalar>>[];
  readonly exclude: readonly Readonly<Record<string, Scalar>>[];
}

export interface CacheSpec {
  readonly key: string;
  readonly paths: readonly string[];
}

export interface ArtifactSpec {
  readonly paths: readonly string[];
  readonly expireIn: string;
}

export interface JobSpec {
  readonly id: string;
  readonly name: string;
  readonly stage: string;
  /** null means "implicit": depend on every job of the previous non-empty stage. */
  readonly needs: readonly string[] | null;
  readonly condition: string | null;
  readonly when: JobWhen;
  readonly runsOn: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly matrix: MatrixSpec | null;
  readonly timeoutMinutes: number;
  readonly retries: number;
  readonly allowFailure: boolean;
  readonly steps: readonly StepSpec[];
  readonly cache: CacheSpec | null;
  readonly artifacts: ArtifactSpec | null;
  readonly environment: string | null;
  readonly concurrency: string | null;
}

export interface ScheduleTrigger {
  readonly cron: string;
}

export interface TriggerSpec {
  readonly push: { readonly branches: readonly string[] } | null;
  readonly manual: boolean;
  readonly schedule: readonly ScheduleTrigger[];
}

export interface PipelineSpec {
  readonly version: 1;
  readonly name: string;
  readonly triggers: TriggerSpec;
  readonly env: Readonly<Record<string, string>>;
  readonly stages: readonly string[];
  readonly jobs: readonly JobSpec[];
}

export type IssueSeverity = 'error' | 'warning';

export interface PipelineIssue {
  readonly severity: IssueSeverity;
  readonly code: string;
  readonly path: string;
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
}

export interface RunContext {
  readonly branch: string;
  readonly sha: string;
  readonly event: TriggerEvent;
  readonly runNumber: number;
}

export interface PlannedStep {
  readonly index: number;
  readonly name: string;
  readonly run: string;
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutSeconds: number;
  readonly continueOnError: boolean;
  readonly workingDirectory: string | null;
}

export interface PlannedJob {
  readonly key: string;
  readonly jobId: string;
  readonly name: string;
  readonly stage: string;
  readonly stageIndex: number;
  readonly matrix: Readonly<Record<string, Scalar>> | null;
  readonly needs: readonly string[];
  readonly level: number;
  readonly when: JobWhen;
  readonly allowFailure: boolean;
  readonly timeoutSeconds: number;
  readonly retries: number;
  readonly runsOn: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly steps: readonly PlannedStep[];
}

export interface ExcludedJob {
  readonly jobId: string;
  readonly reason: string;
}

export interface ExecutionPlan {
  readonly pipelineName: string;
  readonly stages: readonly string[];
  readonly jobs: readonly PlannedJob[];
  readonly levels: readonly (readonly string[])[];
  readonly excluded: readonly ExcludedJob[];
  readonly criticalPath: readonly string[];
}
