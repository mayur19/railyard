import { describe, expect, it } from 'vitest';
import {
  cartesian,
  countCombinations,
  expandMatrix,
  instanceKey,
  instanceName,
  matches,
} from '../src/pipeline/matrix.js';

describe('cartesian', () => {
  it('varies the first axis slowest', () => {
    expect(cartesian({ os: ['linux', 'mac'], node: [20, 22] })).toEqual([
      { os: 'linux', node: 20 },
      { os: 'linux', node: 22 },
      { os: 'mac', node: 20 },
      { os: 'mac', node: 22 },
    ]);
  });

  it('returns no combinations for no axes', () => {
    expect(cartesian({})).toEqual([]);
  });

  it('computes the full product size', () => {
    expect(cartesian({ a: [1, 2, 3], b: [1, 2], c: [true, false] })).toHaveLength(12);
  });
});

describe('expandMatrix', () => {
  it('applies partial excludes', () => {
    const combos = expandMatrix({
      axes: { os: ['linux', 'mac'], node: [20, 22] },
      include: [],
      exclude: [{ os: 'mac', node: 20 }],
    });
    expect(combos).toHaveLength(3);
    expect(combos).not.toContainEqual({ os: 'mac', node: 20 });
  });

  it('excludes with a single key remove every match', () => {
    const combos = expandMatrix({
      axes: { os: ['linux', 'mac'], node: [20, 22] },
      include: [],
      exclude: [{ os: 'mac' }],
    });
    expect(combos.every((c) => c.os === 'linux')).toBe(true);
  });

  it('merges includes into matching combinations without overwriting axes', () => {
    const combos = expandMatrix({
      axes: { os: ['linux', 'mac'], node: [20, 22] },
      include: [{ os: 'linux', experimental: true }],
      exclude: [],
    });
    expect(combos.filter((c) => c.experimental === true)).toHaveLength(2);
    expect(combos).toHaveLength(4);
  });

  it('appends includes that match nothing as new combinations', () => {
    const combos = expandMatrix({
      axes: { os: ['linux'], node: [20] },
      include: [{ os: 'windows', node: 22 }],
      exclude: [],
    });
    expect(combos).toEqual([
      { os: 'linux', node: 20 },
      { os: 'windows', node: 22 },
    ]);
  });

  it('later includes may overwrite keys added by earlier includes', () => {
    const combos = expandMatrix({
      axes: { node: [20] },
      include: [
        { node: 20, label: 'a' },
        { node: 20, label: 'b' },
      ],
      exclude: [],
    });
    expect(combos).toEqual([{ node: 20, label: 'b' }]);
  });

  it('supports include-only matrices', () => {
    expect(
      expandMatrix({ axes: {}, include: [{ target: 'x' }, { target: 'y' }], exclude: [] }),
    ).toHaveLength(2);
  });

  it('matches with string coercion', () => {
    expect(matches({ node: 20 }, { node: '20' })).toBe(true);
    expect(matches({ node: 20 }, { os: 'linux' })).toBe(false);
  });

  it('counts combinations', () => {
    expect(
      countCombinations({ axes: { a: [1, 2], b: [1, 2] }, include: [], exclude: [{ a: 1 }] }),
    ).toBe(2);
  });
});

describe('instance naming', () => {
  it('builds stable keys and names', () => {
    expect(instanceKey('test', { node: 20, os: 'linux' })).toBe('test[node=20,os=linux]');
    expect(instanceKey('build', null)).toBe('build');
    expect(instanceName('Test', { node: 20, os: 'linux' })).toBe('Test (20, linux)');
    expect(instanceName('Build', null)).toBe('Build');
  });
});
