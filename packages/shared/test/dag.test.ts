import { describe, expect, it } from 'vitest';
import {
  ancestors,
  buildGraph,
  criticalPath,
  findCycle,
  topologicalLevels,
} from '../src/pipeline/dag.js';

describe('findCycle', () => {
  it('returns null for acyclic graphs', () => {
    expect(
      findCycle(
        buildGraph([
          ['a', []],
          ['b', ['a']],
          ['c', ['a', 'b']],
        ]),
      ),
    ).toBeNull();
  });

  it('reports a self loop', () => {
    expect(findCycle(buildGraph([['a', ['a']]]))).toEqual(['a', 'a']);
  });

  it('reports the cycle path', () => {
    const cycle = findCycle(
      buildGraph([
        ['a', ['c']],
        ['b', ['a']],
        ['c', ['b']],
        ['d', []],
      ]),
    );
    expect(cycle).not.toBeNull();
    expect(cycle?.[0]).toBe(cycle?.[cycle.length - 1]);
    expect(new Set(cycle)).toEqual(new Set(['a', 'b', 'c']));
  });

  it('handles deep chains without recursion limits', () => {
    const entries: [string, string[]][] = Array.from({ length: 20000 }, (_, i) => [
      `n${i}`,
      i === 0 ? [] : [`n${i - 1}`],
    ]);
    expect(findCycle(buildGraph(entries))).toBeNull();
  });
});

describe('topologicalLevels', () => {
  it('levels nodes by longest dependency chain', () => {
    const levels = topologicalLevels(
      buildGraph([
        ['lint', []],
        ['build', []],
        ['test', ['build']],
        ['deploy', ['test', 'lint']],
      ]),
    );
    expect(levels).toEqual([['lint', 'build'], ['test'], ['deploy']]);
  });

  it('keeps input order within a level', () => {
    expect(
      topologicalLevels(
        buildGraph([
          ['z', []],
          ['a', []],
          ['m', ['z', 'a']],
        ]),
      ),
    ).toEqual([['z', 'a'], ['m']]);
  });

  it('throws on cycles and unknown deps', () => {
    expect(() =>
      topologicalLevels(
        buildGraph([
          ['a', ['b']],
          ['b', ['a']],
        ]),
      ),
    ).toThrow(/cycle/);
    expect(() => topologicalLevels(buildGraph([['a', ['ghost']]]))).toThrow(/unknown dependency/);
  });

  it('respects every edge on random DAGs (property)', () => {
    let seed = 42;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let trial = 0; trial < 50; trial += 1) {
      const size = 5 + Math.floor(random() * 60);
      const entries: [string, string[]][] = [];
      for (let i = 0; i < size; i += 1) {
        const deps = Array.from({ length: i }, (_, j) => `n${j}`).filter(() => random() < 0.15);
        entries.push([`n${i}`, deps]);
      }
      const graph = buildGraph(entries);
      const level = new Map(
        topologicalLevels(graph).flatMap((nodes, l) => nodes.map((n) => [n, l] as const)),
      );
      expect(level.size).toBe(size);
      for (const [node, deps] of entries) {
        for (const dep of deps) expect(level.get(dep)).toBeLessThan(level.get(node) as number);
        const expected =
          deps.length === 0 ? 0 : Math.max(...deps.map((d) => (level.get(d) as number) + 1));
        expect(level.get(node)).toBe(expected);
      }
    }
  });
});

describe('criticalPath', () => {
  const graph = buildGraph([
    ['a', []],
    ['b', ['a']],
    ['c', ['a']],
    ['d', ['b', 'c']],
  ]);

  it('finds the longest chain with unit weights', () => {
    expect(criticalPath(graph)).toHaveLength(3);
    expect(criticalPath(graph)[0]).toBe('a');
    expect(criticalPath(graph)[2]).toBe('d');
  });

  it('honours weights', () => {
    const weights: Record<string, number> = { a: 1, b: 1, c: 10, d: 1 };
    expect(criticalPath(graph, (n) => weights[n] ?? 1)).toEqual(['a', 'c', 'd']);
  });

  it('collects ancestors', () => {
    expect(ancestors(graph, 'd')).toEqual(new Set(['a', 'b', 'c']));
    expect(ancestors(graph, 'a').size).toBe(0);
  });
});
