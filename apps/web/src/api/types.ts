import type { ExecutionPlan, JobStatus, PipelineIssue, RunStatus } from '@railyard/shared';

export interface Principal {
  readonly user: { id: string; email: string; name: string };
  readonly organization: { id: string; name: string; slug: string };
  readonly role: string;
  readonly csrfToken: string;
}

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly repositoryPath: string;
  readonly defaultBranch: string;
  readonly lastRun: { number: number; status: RunStatus; createdAt: string } | null;
}

export interface StepView {
  readonly id: string;
  readonly position: number;
  readonly name: string;
  readonly status: string;
  readonly exitCode: number | null;
}

export interface JobView {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly stage: string;
  readonly level: number;
  readonly needs: string[];
  readonly status: JobStatus;
  readonly attempt: number;
  readonly allowFailure: boolean;
  readonly failureReason: string | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly steps: StepView[];
}

export interface RunSummary {
  readonly id: string;
  readonly number: number;
  readonly status: RunStatus;
  readonly pipelineName: string;
  readonly branch: string;
  readonly commitSha: string;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly jobCounts: Record<string, number>;
}

export interface RunDetail extends RunSummary {
  readonly projectId: string;
  readonly stages: string[];
  readonly criticalPath: string[];
  readonly excluded: { jobId: string; reason: string }[];
  readonly jobs: JobView[];
}

export interface PlanPreview {
  readonly valid: boolean;
  readonly issues: PipelineIssue[];
  readonly plan: ExecutionPlan | null;
}
