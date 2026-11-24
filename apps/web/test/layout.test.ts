import { describe, expect, it } from 'vitest';
import { layoutGraph, NODE_WIDTH } from '../src/graph/layout';
import { formatDuration } from '../src/pages/time';

const jobs = [
  { key: 'build', level: 0, needs: [] },
  { key: 'lint', level: 0, needs: [] },
  { key: 'test', level: 1, needs: ['build'] },
  { key: 'deploy', level: 2, needs: ['test', 'lint'] },
];

describe('layoutGraph', () => {
  it('places one column per level and stacks rows', () => {
    const layout = layoutGraph(jobs);
    const pos = Object.fromEntries(layout.nodes.map((n) => [n.node.key, n]));
    expect(pos.build?.x).toBe(pos.lint?.x);
    expect(pos.lint?.y).toBeGreaterThan(pos.build?.y ?? 0);
    expect(pos.test?.x).toBeGreaterThan((pos.build?.x ?? 0) + NODE_WIDTH);
    expect(layout.width).toBeGreaterThan((pos.deploy?.x ?? 0) + NODE_WIDTH - 1);
  });

  it('creates edges and flags the critical path', () => {
    const layout = layoutGraph(jobs, ['build', 'test', 'deploy']);
    expect(layout.edges).toHaveLength(3);
    expect(layout.edges.filter((e) => e.critical).map((e) => `${e.from}->${e.to}`)).toEqual([
      'build->test',
      'test->deploy',
    ]);
    expect(layout.edges[0]?.path.startsWith('M ')).toBe(true);
  });

  it('ignores edges to unknown nodes and handles empty graphs', () => {
    expect(layoutGraph([{ key: 'a', level: 0, needs: ['ghost'] }]).edges).toEqual([]);
    expect(layoutGraph([]).nodes).toEqual([]);
  });
});

describe('formatDuration', () => {
  it('formats seconds and minutes', () => {
    expect(formatDuration(null, null)).toBe('—');
    expect(formatDuration('2026-01-01T00:00:00Z', '2026-01-01T00:00:42Z')).toBe('42s');
    expect(formatDuration('2026-01-01T00:00:00Z', '2026-01-01T00:02:05Z')).toBe('2m 5s');
    expect(formatDuration('2026-01-01T00:00:00Z', null, Date.parse('2026-01-01T00:00:10Z'))).toBe(
      '10s',
    );
  });
});
