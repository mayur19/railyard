/**
 * Generic DAG helpers used at two granularities: job ids (for cycle reporting) and
 * planned instance keys (for levels and critical path).
 */
export interface Graph {
  /** node -> the nodes it depends on (its predecessors) */
  readonly deps: ReadonlyMap<string, readonly string[]>;
}

export function buildGraph(entries: readonly (readonly [string, readonly string[]])[]): Graph {
  return { deps: new Map(entries.map(([node, deps]) => [node, [...deps]])) };
}

/**
 * Finds one cycle using iterative three-colour DFS. Returns the cycle as a path whose
 * first and last element are equal (e.g. ['a','b','a']), or null if the graph is acyclic.
 * O(V + E).
 */
export function findCycle(graph: Graph): string[] | null {
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const colour = new Map<string, number>([...graph.deps.keys()].map((node) => [node, WHITE]));
  for (const start of graph.deps.keys()) {
    if (colour.get(start) !== WHITE) continue;
    const stack: { node: string; next: number }[] = [{ node: start, next: 0 }];
    colour.set(start, GREY);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1] as { node: string; next: number };
      const deps = graph.deps.get(frame.node) ?? [];
      if (frame.next >= deps.length) {
        colour.set(frame.node, BLACK);
        stack.pop();
        continue;
      }
      const dep = deps[frame.next] as string;
      frame.next += 1;
      const state = colour.get(dep);
      if (state === GREY) {
        const from = stack.findIndex((f) => f.node === dep);
        return [...stack.slice(from).map((f) => f.node), dep];
      }
      if (state === WHITE) {
        colour.set(dep, GREY);
        stack.push({ node: dep, next: 0 });
      }
    }
  }
  return null;
}

/**
 * Kahn's algorithm producing levels: level 0 holds nodes without dependencies, level n holds
 * nodes whose longest dependency chain has length n. Within a level, the input order of
 * `graph.deps` is preserved, which makes the plan deterministic. Throws on cycles. O(V + E).
 */
export function topologicalLevels(graph: Graph): string[][] {
  const order = [...graph.deps.keys()];
  const position = new Map(order.map((node, index) => [node, index]));
  const dependents = new Map<string, string[]>(order.map((node) => [node, []]));
  const remaining = new Map<string, number>();
  for (const [node, deps] of graph.deps) {
    remaining.set(node, deps.length);
    for (const dep of deps) {
      if (!dependents.has(dep)) throw new Error(`unknown dependency '${dep}' of '${node}'`);
      (dependents.get(dep) as string[]).push(node);
    }
  }
  const levels: string[][] = [];
  let frontier = order.filter((node) => remaining.get(node) === 0);
  let visited = 0;
  while (frontier.length > 0) {
    levels.push(frontier);
    visited += frontier.length;
    const next: string[] = [];
    for (const node of frontier) {
      for (const dependent of dependents.get(node) as string[]) {
        const left = (remaining.get(dependent) as number) - 1;
        remaining.set(dependent, left);
        if (left === 0) next.push(dependent);
      }
    }
    frontier = next.sort((a, b) => (position.get(a) as number) - (position.get(b) as number));
  }
  if (visited !== order.length) throw new Error('graph contains a cycle');
  return levels;
}

/**
 * Longest weighted path through the DAG (the critical path). `weight` defaults to 1 per node,
 * in which case the result is the longest dependency chain. Uses the level ordering so each
 * node is relaxed once: O(V + E).
 */
export function criticalPath(graph: Graph, weight: (node: string) => number = () => 1): string[] {
  const levels = topologicalLevels(graph);
  const best = new Map<string, { cost: number; prev: string | null }>();
  for (const node of levels.flat()) {
    const deps = graph.deps.get(node) ?? [];
    const prev = deps.reduce<string | null>((winner, dep) => {
      if (winner === null) return dep;
      return (best.get(dep)?.cost ?? 0) > (best.get(winner)?.cost ?? 0) ? dep : winner;
    }, null);
    best.set(node, { cost: weight(node) + (prev ? (best.get(prev)?.cost ?? 0) : 0), prev });
  }
  let tail: string | null = null;
  for (const [node, entry] of best) {
    if (tail === null || entry.cost > (best.get(tail)?.cost ?? 0)) tail = node;
  }
  const path: string[] = [];
  while (tail !== null) {
    path.unshift(tail);
    tail = best.get(tail)?.prev ?? null;
  }
  return path;
}

/** All transitive predecessors of `node`. */
export function ancestors(graph: Graph, node: string): Set<string> {
  const seen = new Set<string>();
  const stack = [...(graph.deps.get(node) ?? [])];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(graph.deps.get(current) ?? []));
  }
  return seen;
}
