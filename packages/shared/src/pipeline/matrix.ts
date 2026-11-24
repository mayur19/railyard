import type { MatrixSpec, Scalar } from './types.js';

export type Combination = Readonly<Record<string, Scalar>>;

/** Only combinations produced by the cartesian product can absorb include entries. */
interface Slot {
  readonly original: Combination;
  readonly merged: Combination;
  readonly fromProduct: boolean;
}

function sameValue(a: Scalar | undefined, b: Scalar): boolean {
  return a !== undefined && String(a) === String(b);
}

/** True when every key of `partial` is present in `combo` with an equal (string-coerced) value. */
export function matches(combo: Combination, partial: Combination): boolean {
  return Object.entries(partial).every(([key, value]) => sameValue(combo[key], value));
}

/**
 * Cartesian product of the axes in declaration order (first axis varies slowest).
 * Iterative to avoid recursion depth issues; returns [] when no axes are declared.
 */
export function cartesian(axes: Readonly<Record<string, readonly Scalar[]>>): Combination[] {
  const entries = Object.entries(axes);
  if (entries.length === 0) return [];
  return entries.reduce<Combination[]>(
    (acc, [axis, values]) =>
      acc.flatMap((combo) => values.map((value) => ({ ...combo, [axis]: value }))),
    [{}],
  );
}

/**
 * Expands a matrix:
 *  1. cartesian product of all axes;
 *  2. drop combinations matching any `exclude` entry (partial match);
 *  3. apply each `include` entry: it is merged into every combination whose original
 *     axis values it does not overwrite; if it fits none it is appended as a new combination
 *     (appended combinations never absorb later includes).
 * The original-axis check uses the values produced by step 1 so that keys added by an
 * earlier include may be overwritten by a later one.
 */
export function expandMatrix(matrix: MatrixSpec): Combination[] {
  const axisNames = Object.keys(matrix.axes);
  const base = cartesian(matrix.axes).filter(
    (combo) => !matrix.exclude.some((excluded) => matches(combo, excluded)),
  );
  return matrix.include
    .reduce<Slot[]>(
      (acc, entry) => {
        const axisPart = Object.fromEntries(
          Object.entries(entry).filter(([key]) => axisNames.includes(key)),
        );
        let applied = false;
        const next = acc.map((slot) => {
          if (!slot.fromProduct || !matches(slot.original, axisPart)) return slot;
          applied = true;
          return { ...slot, merged: { ...slot.merged, ...entry } };
        });
        return applied ? next : [...next, { original: entry, merged: entry, fromProduct: false }];
      },
      base.map((combo) => ({ original: combo, merged: combo, fromProduct: true })),
    )
    .map((slot) => slot.merged);
}

/**
 * Upper bound on the expansion size without materialising anything: product of axis sizes plus
 * one per include entry. O(axes). Used to reject hostile matrices before expanding them.
 */
export function matrixUpperBound(matrix: MatrixSpec): number {
  const lengths = Object.values(matrix.axes).map((values) => values.length);
  const product =
    lengths.length === 0
      ? 0
      : lengths.reduce((acc, n) => Math.min(acc * n, Number.MAX_SAFE_INTEGER), 1);
  return product + matrix.include.length;
}

/** Number of combinations the matrix expands to, without materialising more than needed. */
export function countCombinations(matrix: MatrixSpec): number {
  return expandMatrix(matrix).length;
}

/** Stable, human-readable key for a matrix instance, e.g. `test[node=20,os=linux]`. */
export function instanceKey(jobId: string, combo: Combination | null): string {
  if (!combo) return jobId;
  const parts = Object.entries(combo).map(([key, value]) => `${key}=${String(value)}`);
  return `${jobId}[${parts.join(',')}]`;
}

export function instanceName(name: string, combo: Combination | null): string {
  if (!combo) return name;
  return `${name} (${Object.values(combo).map(String).join(', ')})`;
}
