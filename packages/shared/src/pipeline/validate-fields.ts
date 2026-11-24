import { checkKeys, isRecord, isScalar, type IssueCollector, type PathPart } from './issues.js';
import { DURATION_PATTERN, ENV_NAME_PATTERN, IDENTIFIER_PATTERN } from './limits.js';
import type { ArtifactSpec, CacheSpec, Scalar } from './types.js';

type Path = readonly PathPart[];

export function readString(
  issues: IssueCollector,
  value: unknown,
  path: Path,
  opts: { required?: boolean; max?: number; pattern?: RegExp; patternHint?: string } = {},
): string | null {
  if (value === undefined || value === null) {
    if (opts.required) issues.error('required', path, 'is required');
    return null;
  }
  if (typeof value !== 'string') {
    issues.error('type', path, `must be a string, got ${describe(value)}`);
    return null;
  }
  if (value.trim() === '') {
    issues.error('empty', path, 'must not be empty');
    return null;
  }
  if (opts.max !== undefined && value.length > opts.max) {
    issues.error('too_long', path, `must be at most ${opts.max} characters`);
    return null;
  }
  if (opts.pattern && !opts.pattern.test(value)) {
    issues.error(
      'pattern',
      path,
      `'${value}' is invalid${opts.patternHint ? `: ${opts.patternHint}` : ''}`,
    );
    return null;
  }
  return value;
}

export function readInteger(
  issues: IssueCollector,
  value: unknown,
  path: Path,
  min: number,
  max: number,
): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    issues.error('type', path, `must be an integer, got ${describe(value)}`);
    return null;
  }
  if (value < min || value > max) {
    issues.error('range', path, `must be between ${min} and ${max}`);
    return null;
  }
  return value;
}

export function readBoolean(issues: IssueCollector, value: unknown, path: Path): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'boolean') {
    issues.error('type', path, `must be true or false, got ${describe(value)}`);
    return null;
  }
  return value;
}

/** Accepts a single string or a list of strings. Duplicates are reported. */
export function readStringList(
  issues: IssueCollector,
  value: unknown,
  path: Path,
  opts: { pattern?: RegExp; patternHint?: string; allowSingle?: boolean } = {},
): string[] | null {
  if (value === undefined || value === null) return null;
  const list = opts.allowSingle && typeof value === 'string' ? [value] : value;
  if (!Array.isArray(list)) {
    issues.error('type', path, `must be a list of strings, got ${describe(value)}`);
    return null;
  }
  const out: string[] = [];
  list.forEach((item, index) => {
    const str = readString(issues, item, [...path, index], opts);
    if (str === null) return;
    if (out.includes(str)) issues.error('duplicate', [...path, index], `duplicate entry '${str}'`);
    else out.push(str);
  });
  return out;
}

export function readEnv(
  issues: IssueCollector,
  value: unknown,
  path: Path,
): Record<string, string> {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) {
    issues.error('type', path, `must be a map of NAME: value, got ${describe(value)}`);
    return {};
  }
  const env: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!ENV_NAME_PATTERN.test(key)) {
      issues.error('pattern', [...path, key], `'${key}' is not a valid environment variable name`);
    } else if (!isScalar(raw)) {
      issues.error('type', [...path, key], 'value must be a string, number or boolean');
    } else {
      env[key] = String(raw);
    }
  }
  return env;
}

export function readScalarMap(
  issues: IssueCollector,
  value: unknown,
  path: Path,
): Record<string, Scalar> | null {
  if (!isRecord(value) || Object.keys(value).length === 0) {
    issues.error('type', path, 'must be a non-empty map of axis: value');
    return null;
  }
  const out: Record<string, Scalar> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!IDENTIFIER_PATTERN.test(key))
      issues.error('pattern', [...path, key], `'${key}' is not a valid axis name`);
    else if (!isScalar(raw)) issues.error('type', [...path, key], 'must be a scalar value');
    else out[key] = raw;
  }
  return out;
}

export function readCache(issues: IssueCollector, value: unknown, path: Path): CacheSpec | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) {
    issues.error('type', path, 'must be a map with key and paths');
    return null;
  }
  checkKeys(issues, value, ['key', 'paths'], path);
  const key = readString(issues, value.key, [...path, 'key'], { required: true, max: 256 });
  const paths = readRelativePaths(issues, value.paths, [...path, 'paths']);
  return key && paths ? { key, paths } : null;
}

export function readArtifacts(
  issues: IssueCollector,
  value: unknown,
  path: Path,
): ArtifactSpec | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) {
    issues.error('type', path, 'must be a map with paths and expire-in');
    return null;
  }
  checkKeys(issues, value, ['paths', 'expire-in'], path);
  const paths = readRelativePaths(issues, value.paths, [...path, 'paths']);
  const expireIn =
    value['expire-in'] === undefined
      ? '7d'
      : readString(issues, value['expire-in'], [...path, 'expire-in'], {
          pattern: DURATION_PATTERN,
          patternHint: 'use a duration such as 30m, 12h, 7d or 2w',
        });
  return paths && expireIn ? { paths, expireIn } : null;
}

function readRelativePaths(issues: IssueCollector, value: unknown, path: Path): string[] | null {
  if (value === undefined) {
    issues.error('required', path, 'is required');
    return null;
  }
  const list = readStringList(issues, value, path);
  if (!list) return null;
  if (list.length === 0) {
    issues.error('empty', path, 'must contain at least one path');
    return null;
  }
  const bad = list.findIndex((p) => !isSafeRelativePath(p));
  if (bad >= 0) {
    issues.error(
      'unsafe_path',
      [...path, bad],
      'paths must be relative and stay inside the workspace',
    );
    return null;
  }
  return list;
}

export function isSafeRelativePath(p: string): boolean {
  if (p.startsWith('/') || p.startsWith('~') || /^[A-Za-z]:/.test(p)) return false;
  return !p.split(/[\\/]/).includes('..');
}

export function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'object') return 'a map';
  return typeof value;
}
