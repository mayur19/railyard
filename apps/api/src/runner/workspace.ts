import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

export class WorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceError';
  }
}

/** Creates an isolated, empty working directory per job attempt: <root>/<runId>/<jobId>-a<attempt>. */
export async function createWorkspace(
  root: string,
  runId: string,
  jobId: string,
  attempt: number,
): Promise<string> {
  const dir = path.resolve(root, runId, `${jobId}-a${attempt}`);
  await rm(dir, { recursive: true, force: true });
  await mkdir(path.join(dir, '.tmp'), { recursive: true });
  return dir;
}

/** Resolves a step working directory, refusing anything that escapes the workspace. */
export async function resolveStepDirectory(
  workspace: string,
  relative: string | null,
): Promise<string> {
  if (!relative) return workspace;
  const resolved = path.resolve(workspace, relative);
  if (resolved !== workspace && !resolved.startsWith(workspace + path.sep)) {
    throw new WorkspaceError(`working directory '${relative}' escapes the workspace`);
  }
  await mkdir(resolved, { recursive: true });
  return resolved;
}

export async function removeWorkspace(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

/**
 * The step environment is built from scratch: runner secrets such as DATABASE_URL or
 * SESSION_SECRET are never inherited by user scripts.
 */
export function buildStepEnv(
  workspace: string,
  jobEnv: Readonly<Record<string, string>>,
  stepEnv: Readonly<Record<string, string>>,
): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: workspace,
    TMPDIR: path.join(workspace, '.tmp'),
    LANG: process.env.LANG ?? 'C',
    RAILYARD_WORKSPACE: workspace,
    ...jobEnv,
    ...stepEnv,
  };
}
