import { spawn } from 'node:child_process';

export type StepResult = 'succeeded' | 'failed' | 'timed_out' | 'cancelled';

export interface StepExecution {
  readonly script: string;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly onOutput: (stream: 'stdout' | 'stderr', text: string) => void;
  readonly signal?: AbortSignal;
  readonly killGraceMs?: number;
}

export interface StepOutcome {
  readonly result: StepResult;
  readonly exitCode: number | null;
  readonly durationMs: number;
}

/**
 * Runs one shell step with bash in its own process group (detached) so that timeouts and
 * cancellation can terminate the whole tree: SIGTERM to -pid, then SIGKILL after a grace period.
 * `set -e -o pipefail` semantics make a failing command fail the step.
 */
export function runStep(exec: StepExecution): Promise<StepOutcome> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', exec.script], {
      cwd: exec.cwd,
      env: { ...exec.env },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let reason: 'timed_out' | 'cancelled' | null = null;
    let killTimer: NodeJS.Timeout | null = null;

    const terminate = (why: 'timed_out' | 'cancelled'): void => {
      if (reason) return;
      reason = why;
      signalGroup(child.pid, 'SIGTERM');
      killTimer = setTimeout(() => signalGroup(child.pid, 'SIGKILL'), exec.killGraceMs ?? 3000);
    };
    const timer = setTimeout(() => terminate('timed_out'), Math.max(1, exec.timeoutMs));
    const onAbort = (): void => terminate('cancelled');
    exec.signal?.addEventListener('abort', onAbort, { once: true });
    if (exec.signal?.aborted) onAbort();

    child.stdout.setEncoding('utf8').on('data', (text: string) => exec.onOutput('stdout', text));
    child.stderr.setEncoding('utf8').on('data', (text: string) => exec.onOutput('stderr', text));

    const finish = (exitCode: number | null, spawnError?: Error): void => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      exec.signal?.removeEventListener('abort', onAbort);
      if (spawnError) exec.onOutput('stderr', `failed to start step: ${spawnError.message}\n`);
      const result: StepResult = reason ?? (exitCode === 0 ? 'succeeded' : 'failed');
      resolve({ result, exitCode, durationMs: Date.now() - started });
    };
    child.once('error', (err) => finish(null, err));
    child.once('close', (code) => finish(code));
  });
}

function signalGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (!pid) return;
  try {
    process.kill(-pid, signal);
  } catch {
    // Group already exited.
  }
}
