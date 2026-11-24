import { describe, expect, it } from 'vitest';
import { checkReference, createResolver } from '../src/pipeline/context.js';
import { interpolate, parseTemplate } from '../src/pipeline/interpolate.js';
import type { RunContext } from '../src/pipeline/types.js';

const run: RunContext = { branch: 'feature/x', sha: 'abc1234', event: 'manual', runNumber: 7 };

describe('interpolation', () => {
  const resolver = createResolver(run, { NAME: 'railyard' }, { node: 22 });

  it('replaces placeholders with evaluated values', () => {
    expect(interpolate('node ${{ matrix.node }} on ${{branch}} #${{ run_number }}', resolver)).toBe(
      'node 22 on feature/x #7',
    );
    expect(interpolate('${{ env.NAME }}-${{ sha }}-${{ event }}', resolver)).toBe(
      'railyard-abc1234-manual',
    );
  });

  it('supports expressions inside placeholders', () => {
    expect(interpolate('${{ matrix.node == 22 }}', resolver)).toBe('true');
  });

  it('returns templates without placeholders untouched', () => {
    expect(interpolate('echo $HOME', resolver)).toBe('echo $HOME');
  });

  it('parses placeholders and rejects unterminated ones', () => {
    expect(parseTemplate('a ${{ x }} b ${{ y.z }}').map((p) => p.source)).toEqual(['x', 'y.z']);
    expect(() => parseTemplate('echo ${{ matrix.node')).toThrow(/unterminated/);
  });

  it('resolver returns undefined for unknown names', () => {
    expect(resolver(['matrix', 'missing'])).toBeUndefined();
    expect(resolver(['branch', 'x'])).toBeUndefined();
    expect(resolver(['other'])).toBeUndefined();
    expect(createResolver(run, {}, null)(['matrix', 'node'])).toBeUndefined();
    expect(resolver(['env'])).toBeUndefined();
  });
});

describe('reference checking', () => {
  const scope = { matrixAxes: new Set(['node']), envNames: new Set(['A']) };
  it.each([
    [['branch'], null],
    [['run_number'], null],
    [['matrix', 'node'], null],
    [['matrix', 'os'], "unknown matrix axis 'os'"],
    [['matrix'], "matrix references take the form 'matrix.<axis>'"],
    [['env', 'A'], null],
    [['env', 'B'], "unknown env variable 'B'"],
    [['env'], "env references take the form 'env.<NAME>'"],
    [['secrets', 'X'], "unknown reference 'secrets.X'"],
  ])('%j', (path, expected) => {
    expect(checkReference(path, scope)).toBe(expected);
  });

  it('rejects matrix references outside matrix jobs', () => {
    expect(checkReference(['matrix', 'node'], { matrixAxes: null, envNames: new Set() })).toMatch(
      /only available/,
    );
  });
});
