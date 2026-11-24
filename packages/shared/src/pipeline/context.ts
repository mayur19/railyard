import type { ExprValue, Resolver } from './expression.js';
import type { RunContext, Scalar } from './types.js';

/** Top-level names available to expressions. `matrix.*` is only available inside matrix jobs. */
export const RUN_REFERENCES = ['branch', 'sha', 'event', 'run_number'] as const;

export interface ReferenceScope {
  readonly matrixAxes: ReadonlySet<string> | null;
  readonly envNames: ReadonlySet<string>;
}

/** Returns an error message when a reference is not resolvable in the given scope, else null. */
export function checkReference(path: readonly string[], scope: ReferenceScope): string | null {
  const [head, ...rest] = path;
  if (head === 'matrix') {
    if (!scope.matrixAxes) return "'matrix' is only available in jobs that declare a matrix";
    if (rest.length !== 1) return "matrix references take the form 'matrix.<axis>'";
    return scope.matrixAxes.has(rest[0] as string) ? null : `unknown matrix axis '${rest[0]}'`;
  }
  if (head === 'env') {
    if (rest.length !== 1) return "env references take the form 'env.<NAME>'";
    return scope.envNames.has(rest[0] as string) ? null : `unknown env variable '${rest[0]}'`;
  }
  if ((RUN_REFERENCES as readonly string[]).includes(head as string) && rest.length === 0)
    return null;
  return `unknown reference '${path.join('.')}'`;
}

export function createResolver(
  run: RunContext,
  env: Readonly<Record<string, string>>,
  matrix: Readonly<Record<string, Scalar>> | null,
): Resolver {
  return (path): ExprValue | undefined => {
    const [head, key] = path;
    if (head === 'matrix') return matrix && key !== undefined ? matrix[key] : undefined;
    if (head === 'env') return key !== undefined ? env[key] : undefined;
    if (path.length !== 1) return undefined;
    if (head === 'branch') return run.branch;
    if (head === 'sha') return run.sha;
    if (head === 'event') return run.event;
    if (head === 'run_number') return run.runNumber;
    return undefined;
  };
}
