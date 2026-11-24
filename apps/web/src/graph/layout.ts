export interface GraphNodeInput {
  readonly key: string;
  readonly level: number;
  readonly needs: readonly string[];
}

export interface PositionedNode<T extends GraphNodeInput> {
  readonly node: T;
  readonly x: number;
  readonly y: number;
}

export interface Edge {
  readonly from: string;
  readonly to: string;
  readonly path: string;
  readonly critical: boolean;
}

export interface GraphLayout<T extends GraphNodeInput> {
  readonly nodes: PositionedNode<T>[];
  readonly edges: Edge[];
  readonly width: number;
  readonly height: number;
}

export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 48;
const COLUMN_GAP = 72;
const ROW_GAP = 16;
const PADDING = 16;

/**
 * Column-per-level layout: each topological level becomes a column, nodes keep their input order
 * inside a column, and edges are cubic curves from a dependency's right edge to the dependent's
 * left edge. Edges between consecutive critical-path nodes are flagged for highlighting.
 */
export function layoutGraph<T extends GraphNodeInput>(
  input: readonly T[],
  criticalPath: readonly string[] = [],
): GraphLayout<T> {
  const columns = new Map<number, T[]>();
  for (const node of input) columns.set(node.level, [...(columns.get(node.level) ?? []), node]);
  const positioned = new Map<string, PositionedNode<T>>();
  for (const [level, nodes] of columns) {
    nodes.forEach((node, row) => {
      positioned.set(node.key, {
        node,
        x: PADDING + level * (NODE_WIDTH + COLUMN_GAP),
        y: PADDING + row * (NODE_HEIGHT + ROW_GAP),
      });
    });
  }
  const criticalEdges = new Set(
    criticalPath.slice(1).map((key, i) => `${criticalPath[i]}->${key}`),
  );
  const edges: Edge[] = input.flatMap((node) =>
    node.needs.flatMap((dep) => {
      const from = positioned.get(dep);
      const to = positioned.get(node.key);
      if (!from || !to) return [];
      const x1 = from.x + NODE_WIDTH;
      const y1 = from.y + NODE_HEIGHT / 2;
      const x2 = to.x;
      const y2 = to.y + NODE_HEIGHT / 2;
      const mid = (x1 + x2) / 2;
      return [
        {
          from: dep,
          to: node.key,
          path: `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`,
          critical: criticalEdges.has(`${dep}->${node.key}`),
        },
      ];
    }),
  );
  const maxLevel = Math.max(0, ...input.map((n) => n.level));
  const maxRows = Math.max(1, ...[...columns.values()].map((c) => c.length));
  return {
    nodes: [...positioned.values()],
    edges,
    width: PADDING * 2 + (maxLevel + 1) * NODE_WIDTH + maxLevel * COLUMN_GAP,
    height: PADDING * 2 + maxRows * NODE_HEIGHT + (maxRows - 1) * ROW_GAP,
  };
}
