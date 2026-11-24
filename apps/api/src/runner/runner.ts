import { hostname } from 'node:os';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
import type { Pool } from '../db/pool.js';
import { maxSeq } from '../modules/logs/log.repository.js';
import { completeJob, type AttemptResult } from '../modules/runs/run-progress.js';
import { runStep } from './executor.js';
import {
  extendLease,
  leaseNextJob,
  markRunner,
  markStepFinished,
  markStepStarted,
  reapExpiredLeases,
  registerRunner,
  type LeasedJob,
  type LeasedStep,
} from './lease.js';
import { LogWriter } from './log-writer.js';
import {
  buildStepEnv,
  createWorkspace,
  removeWorkspace,
  resolveStepDirectory,
} from './workspace.js';

export const RUNNER_VERSION = '0.1.0';
const REAP_EVERY_MS = 10_000;

export interface RunnerOptions {
  readonly pool: Pool;
  readonly logger: Logger;
  readonly config: Pick<
    AppConfig,
    'WORKSPACE_ROOT' | 'RUNNER_LEASE_SECONDS' | 'RUNNER_POLL_MS' | 'RUNNER_KEEP_WORKSPACES'
  >;
  readonly name?: string;
  readonly labels?: string[];
}

interface JobOutcome {
  readonly result: AttemptResult;
  readonly exitCode: number | null;
  readonly reason: string | null;
}

/**
 * A runner process: registers itself, then loops lease -> execute -> complete. Multiple runner
 * processes (on one or many hosts) coordinate purely through Postgres row locks.
 */
export class Runner {
  readonly name: string;
  private stopping = false;
  private lastReap = 0;
  private loop: Promise<void> | null = null;

  constructor(private readonly opts: RunnerOptions) {
    this.name = opts.name ?? `${hostname()}-${process.pid}`;
  }

  async register(): Promise<void> {
    await registerRunner(this.opts.pool, {
      name: this.name,
      hostname: hostname(),
      labels: this.opts.labels ?? ['linux', 'shell'],
      version: RUNNER_VERSION,
    });
  }

  start(): void {
    this.loop = this.run();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    await this.loop;
    await markRunner(this.opts.pool, this.name, 'offline');
  }

  private async run(): Promise<void> {
    await this.register();
    this.opts.logger.info({ runner: this.name }, 'runner started');
    while (!this.stopping) {
      try {
        const worked = await this.runOnce();
        if (!worked) await sleep(this.opts.config.RUNNER_POLL_MS);
      } catch (err) {
        this.opts.logger.error({ err }, 'runner iteration failed');
        await sleep(this.opts.config.RUNNER_POLL_MS);
      }
    }
  }

  /** One iteration: reap if due, then lease and execute at most one job. Returns true if a job ran. */
  async runOnce(): Promise<boolean> {
    if (Date.now() - this.lastReap > REAP_EVERY_MS) {
      this.lastReap = Date.now();
      const reaped = await reapExpiredLeases(this.opts.pool);
      if (reaped > 0) this.opts.logger.warn({ reaped }, 'reaped expired leases');
    }
    const job = await leaseNextJob(
      this.opts.pool,
      this.name,
      this.opts.config.RUNNER_LEASE_SECONDS,
    );
    if (!job) return false;
    await this.execute(job);
    return true;
  }

  private async execute(job: LeasedJob): Promise<void> {
    const { pool, logger, config } = this.opts;
    const log = logger.child({ jobId: job.id, key: job.key, attempt: job.attempt });
    const writer = new LogWriter({
      pool,
      jobId: job.id,
      attempt: job.attempt,
      firstSeq: (await maxSeq(pool, job.id)) + 1,
    });
    const leaseLost = new AbortController();
    const heartbeat = setInterval(
      () => {
        extendLease(pool, job.id, this.name, config.RUNNER_LEASE_SECONDS)
          .then((held) => {
            if (!held) leaseLost.abort();
          })
          .catch((err: unknown) => log.warn({ err }, 'heartbeat failed'));
      },
      Math.max(1000, (config.RUNNER_LEASE_SECONDS * 1000) / 3),
    );

    const workspace = await createWorkspace(config.WORKSPACE_ROOT, job.runId, job.id, job.attempt);
    writer.system(`[railyard] ${job.name} - attempt ${job.attempt} on ${this.name}`);
    let outcome: JobOutcome;
    try {
      outcome = await this.runSteps(job, workspace, writer, leaseLost.signal);
    } catch (err) {
      log.error({ err }, 'job execution error');
      writer.system(`[railyard] internal error: ${(err as Error).message}`);
      outcome = { result: 'failed', exitCode: null, reason: 'runner error' };
    } finally {
      clearInterval(heartbeat);
    }
    writer.system(
      `[railyard] job ${outcome.result}${outcome.reason ? ` (${outcome.reason})` : ''}`,
    );
    await writer.close();
    if (!leaseLost.signal.aborted) {
      const completion = await completeJob(pool, {
        jobId: job.id,
        leaseOwner: this.name,
        ...outcome,
      });
      log.info(
        { result: outcome.result, retried: completion.retried, runStatus: completion.runStatus },
        'job finished',
      );
    } else {
      log.warn('lease lost; result discarded');
    }
    if (!config.RUNNER_KEEP_WORKSPACES) await removeWorkspace(workspace);
  }

  private async runSteps(
    job: LeasedJob,
    workspace: string,
    writer: LogWriter,
    signal: AbortSignal,
  ): Promise<JobOutcome> {
    const deadline = Date.now() + job.timeoutSeconds * 1000;
    let outcome: JobOutcome = { result: 'succeeded', exitCode: 0, reason: null };
    for (const step of job.steps) {
      if (outcome.result !== 'succeeded' || signal.aborted) {
        await markStepFinished(
          this.opts.pool,
          step.id,
          signal.aborted ? 'cancelled' : 'skipped',
          null,
        );
        continue;
      }
      outcome = await this.runOneStep(job, step, workspace, writer, signal, deadline);
    }
    return signal.aborted ? { result: 'cancelled', exitCode: null, reason: 'lease lost' } : outcome;
  }

  private async runOneStep(
    job: LeasedJob,
    step: LeasedStep,
    workspace: string,
    writer: LogWriter,
    signal: AbortSignal,
    deadline: number,
  ): Promise<JobOutcome> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      await markStepFinished(this.opts.pool, step.id, 'skipped', null);
      return { result: 'timed_out', exitCode: null, reason: 'job timeout' };
    }
    await markStepStarted(this.opts.pool, step.id);
    writer.system(`$ ${step.name}`);
    const stepTimeoutMs = step.timeoutSeconds * 1000;
    const jobLimited = remaining < stepTimeoutMs;
    const exec = await runStep({
      script: step.script,
      cwd: await resolveStepDirectory(workspace, step.workingDirectory),
      env: buildStepEnv(workspace, job.env, step.env),
      timeoutMs: Math.min(stepTimeoutMs, remaining),
      onOutput: (stream, text) => writer.write(stream, text),
      signal,
    });
    await markStepFinished(this.opts.pool, step.id, exec.result, exec.exitCode);
    writer.system(
      `[railyard] step '${step.name}' ${exec.result} (exit ${exec.exitCode ?? '-'}, ${exec.durationMs} ms)`,
    );
    if (exec.result === 'succeeded') return { result: 'succeeded', exitCode: 0, reason: null };
    if (exec.result === 'failed' && step.continueOnError) {
      writer.system(`[railyard] continue-on-error: ignoring failure of '${step.name}'`);
      return { result: 'succeeded', exitCode: 0, reason: null };
    }
    if (exec.result === 'timed_out') {
      return {
        result: 'timed_out',
        exitCode: exec.exitCode,
        reason: jobLimited ? 'job timeout' : `step '${step.name}' timed out`,
      };
    }
    return {
      result: exec.result,
      exitCode: exec.exitCode,
      reason: exec.result === 'failed' ? `step '${step.name}' failed` : null,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
