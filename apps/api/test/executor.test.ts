import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runStep } from '../src/runner/executor.js';

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'railyard-exec-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function collect() {
  const out: { stream: string; text: string }[] = [];
  return {
    out,
    onOutput: (stream: 'stdout' | 'stderr', text: string) => out.push({ stream, text }),
  };
}

describe('runStep', () => {
  it('captures stdout and stderr and succeeds', async () => {
    const { out, onOutput } = collect();
    const res = await runStep({
      script: 'echo hello; echo oops >&2',
      cwd: dir,
      env: { PATH: process.env.PATH ?? '' },
      timeoutMs: 5000,
      onOutput,
    });
    expect(res).toMatchObject({ result: 'succeeded', exitCode: 0 });
    expect(
      out
        .filter((o) => o.stream === 'stdout')
        .map((o) => o.text)
        .join(''),
    ).toBe('hello\n');
    expect(
      out
        .filter((o) => o.stream === 'stderr')
        .map((o) => o.text)
        .join(''),
    ).toBe('oops\n');
  });

  it('fails on the first failing command (errexit + pipefail)', async () => {
    const { out, onOutput } = collect();
    const res = await runStep({
      script: 'false | cat\necho unreachable',
      cwd: dir,
      env: { PATH: process.env.PATH ?? '' },
      timeoutMs: 5000,
      onOutput,
    });
    expect(res).toMatchObject({ result: 'failed', exitCode: 1 });
    expect(out.map((o) => o.text).join('')).not.toContain('unreachable');
  });

  it('reports custom exit codes and passes env and cwd', async () => {
    const { out, onOutput } = collect();
    const res = await runStep({
      script: 'echo "$GREETING from $(pwd)"; exit 3',
      cwd: dir,
      env: { PATH: process.env.PATH ?? '', GREETING: 'hi' },
      timeoutMs: 5000,
      onOutput,
    });
    expect(res.exitCode).toBe(3);
    expect(out.map((o) => o.text).join('')).toContain(`hi from`);
  });

  it('kills the whole process group on timeout', async () => {
    const { onOutput } = collect();
    const started = Date.now();
    const res = await runStep({
      script: 'sleep 30 & sleep 30; wait',
      cwd: dir,
      env: { PATH: process.env.PATH ?? '' },
      timeoutMs: 300,
      onOutput,
      killGraceMs: 500,
    });
    expect(res.result).toBe('timed_out');
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('cancels when the abort signal fires', async () => {
    const controller = new AbortController();
    const { onOutput } = collect();
    setTimeout(() => controller.abort(), 200);
    const res = await runStep({
      script: 'sleep 30',
      cwd: dir,
      env: { PATH: process.env.PATH ?? '' },
      timeoutMs: 10_000,
      onOutput,
      signal: controller.signal,
    });
    expect(res.result).toBe('cancelled');
  });

  it('cancels immediately when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const res = await runStep({
      script: 'sleep 30',
      cwd: dir,
      env: { PATH: process.env.PATH ?? '' },
      timeoutMs: 10_000,
      onOutput: () => undefined,
      signal: controller.signal,
      killGraceMs: 100,
    });
    expect(res.result).toBe('cancelled');
  });

  it('reports a spawn failure for a missing working directory', async () => {
    const { out, onOutput } = collect();
    const res = await runStep({
      script: 'echo x',
      cwd: path.join(dir, 'missing'),
      env: { PATH: process.env.PATH ?? '' },
      timeoutMs: 1000,
      onOutput,
    });
    expect(res.result).toBe('failed');
    expect(out.map((o) => o.text).join('')).toMatch(/failed to start step/);
  });
});
