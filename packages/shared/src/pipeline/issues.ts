import type { IssueSeverity, PipelineIssue } from './types.js';

export type PathPart = string | number;

export function formatPath(path: readonly PathPart[]): string {
  return path.reduce<string>((acc, part) => {
    if (typeof part === 'number') return `${acc}[${part}]`;
    return acc === '' ? part : `${acc}.${part}`;
  }, '');
}

/** Accumulates validation issues. Issues are frozen once recorded. */
export class IssueCollector {
  private readonly items: PipelineIssue[] = [];
  private readonly rawPaths: (readonly PathPart[])[] = [];

  add(severity: IssueSeverity, code: string, path: readonly PathPart[], message: string): void {
    this.items.push(Object.freeze({ severity, code, path: formatPath(path) || '$', message }));
    this.rawPaths.push([...path]);
  }

  error(code: string, path: readonly PathPart[], message: string): void {
    this.add('error', code, path, message);
  }

  warn(code: string, path: readonly PathPart[], message: string): void {
    this.add('warning', code, path, message);
  }

  get hasErrors(): boolean {
    return this.items.some((issue) => issue.severity === 'error');
  }

  /** Returns the issues, optionally decorated with source positions. */
  list(
    locate?: (path: readonly PathPart[]) => { line: number; column: number } | null,
  ): PipelineIssue[] {
    return this.items.map((issue, index) => {
      const position = locate?.(this.rawPaths[index] as PathPart[]) ?? null;
      return position ? { ...issue, ...position } : issue;
    });
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

export function checkKeys(
  issues: IssueCollector,
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: readonly PathPart[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      issues.error(
        'unknown_key',
        [...path, key],
        `unknown key '${key}' (allowed: ${allowed.join(', ')})`,
      );
    }
  }
}
